import type { PluginTool } from '../types';
import { githubActionsUpgradeStatusPlugin } from './github-actions-upgrade-status';

export type ScheduleType = 'daily' | 'interval' | 'idle';

export interface ProactiveRule {
  id: string;
  title: string;
  message: string;
  scheduleType: ScheduleType;
  time: string;
  intervalMinutes: number;
  enabled: boolean;
  aiGenerated: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
}

export interface UpgradeTrackingState {
  tracking: boolean;
  repo: string;
  workflowFile: string;
  runId: string;
  actionsUrl: string;
  prUrl: string;
  summary: string;
  lastKnownStatus: string;
  lastKnownConclusion: string | null;
  lastKnownError: string;
  reported: boolean;
  reportedRunKeys: string[];
  startedAt: string | null;
  lastCheckedAt: string | null;
  reportedAt: string | null;
}

export interface ProactiveUserStore {
  userId: string;
  globalEnabled: boolean;
  timezone: string;
  lastInteractionAt: string;
  updatedAt: string;
  rules: ProactiveRule[];
  upgradeTracking: UpgradeTrackingState;
}

export interface KvLatestUpgradeSnapshot {
  status: string;
  step: string;
  request: string;
  summary: string;
  prUrl: string;
  actionsUrl: string;
  changedFiles: string[];
  logs: string[];
  error: string;
  startedAt: string | null;
  updatedAt: string | null;
}

interface KvUpgradeAnalysis {
  hasKv: boolean;
  statusLower: string;
  stepLower: string;
  isRejected: boolean;
  isCancelled: boolean;
  isTimedOut: boolean;
  isFailedOrCancelled: boolean;
  isMergedSuccess: boolean;
  isRunning: boolean;
  verdict: 'success' | 'rejected' | 'cancelled' | 'timed_out' | 'failure' | 'running' | 'idle';
  reasons: string[];
}

interface KvNamespaceLike {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<unknown>;
}

interface StateServiceLike {
  getUpgradeStatus?: (userId: string) => Promise<unknown>;
}

interface CacheLike {
  match: (request: Request | string) => Promise<Response | undefined>;
  put: (request: Request | string, response: Response) => Promise<void>;
}

interface GeminiCandidatePart {
  text?: string;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiCandidatePart[];
  };
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
}

interface ParsedGitHubTarget {
  repo?: string;
  runId?: string;
  workflowFile?: string;
}

interface DueNotificationItem extends ProactiveRule {
  originalMessage?: string;
  aiGeneratedSuccess?: boolean;
  upgradeReport?: {
    verdict: string;
    runId: string;
    status: string;
    conclusion: string;
    actionsUrl: string;
    prUrl: string;
    failedSteps: string[];
    annotationsSummary: string[];
    errorReasons: string[];
  };
}

const MEMORY_STORE = new Map<string, ProactiveUserStore>();
const DEFAULT_TIMEZONE = 'Asia/Taipei';
const DEFAULT_REPO = 'ZeroAker/gemini-pet-bff';
const DEFAULT_WORKFLOW_FILE = 'self-upgrade-runner.yml';
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_ID_PATTERN = /^\d+$/;
const WORKFLOW_PATTERN = /^[A-Za-z0-9_.-]+$/;

const REJECTION_KEYWORD_PATTERN =
  /(\brejected\b|reject_upgrade|安全閘門|拒絕修改|拒絕升級|受保護|核心模組|核心功能|白名單|不在可編輯|不可修改|禁止刪除|PROTECTED_CORE)/i;

const KV_CODE_ERROR_PATTERN =
  /(error\s+TS\d+|tsc\s+--noEmit.*(?:失敗|錯誤|error)|型別檢查(?:失敗|未通過|錯誤)|型別錯誤|語法錯誤|語法驗證(?:失敗|未通過)|SyntaxError|TypeError|沙盒驗證(?:失敗|未通過)|安全掃描(?:失敗|未通過)|編譯失敗|编译失败|run_checks\s*(?:失敗|未通過))/i;

const KV_MERGE_SUCCESS_PATTERN = /(升級已自動合併至\s*main|已自動合併至\s*main|merged\s+to\s+main)/i;

const LOG_ACCESS_NOISE_PATTERN =
  /(無法直接下載原始純文字\s*log|無法下載純文字\s*log|原始\s*log\s*下載通常需要認證|下載原始純文字\s*log\s*逾時|完成後才可下載完整純文字\s*log|actions\/jobs\/\d+\/logs.*403|HTTP\s*403.*原始.*log|已達未認證速率上限)/i;

const ACTIONS_FAILURE_CONCLUSIONS = new Set([
  'cancelled',
  'canceled',
  'failure',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
]);

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') return true;
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') return false;
  }
  return fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(10080, Math.round(value)));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(10080, Math.round(parsed)));
    }
  }
  return fallback;
}

function isIgnorableLogAccessWarning(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return LOG_ACCESS_NOISE_PATTERN.test(trimmed);
}

function normalizeTime(raw: string, fallback = '09:00'): string {
  const match = TIME_PATTERN.exec(raw.trim());
  if (!match) return fallback;
  const hh = (match[1] ?? '09').padStart(2, '0');
  const mm = (match[2] ?? '00').padStart(2, '0');
  return `${hh}:${mm}`;
}

function normalizeScheduleType(
  raw: string,
  hasExplicitTime: boolean,
  hasExplicitInterval: boolean
): ScheduleType {
  const lower = raw.toLowerCase();
  if (lower === 'daily' || lower === 'interval' || lower === 'idle') {
    return lower;
  }
  if (hasExplicitTime && !hasExplicitInterval) return 'daily';
  if (hasExplicitInterval) return 'interval';
  return 'daily';
}

function parseGitHubActionsUrl(rawUrl: string): ParsedGitHubTarget {
  if (!rawUrl) return {};
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter((segment) => segment.length > 0);

    if (host === 'api.github.com' && parts[0] === 'repos') {
      const owner = parts[1];
      const repoName = parts[2];
      if (!owner || !repoName) return {};
      const candidateRepo = `${owner}/${repoName}`;
      if (!REPO_PATTERN.test(candidateRepo)) return {};
      const result: ParsedGitHubTarget = { repo: candidateRepo };
      if (parts[3] === 'actions' && parts[4] === 'runs' && parts[5] && RUN_ID_PATTERN.test(parts[5])) {
        result.runId = parts[5];
      } else if (
        parts[3] === 'actions' &&
        parts[4] === 'workflows' &&
        parts[5] &&
        WORKFLOW_PATTERN.test(parts[5])
      ) {
        result.workflowFile = parts[5];
      }
      return result;
    }

    if (host !== 'github.com' && host !== 'www.github.com') {
      return {};
    }
    const owner = parts[0];
    const repoName = parts[1];
    if (!owner || !repoName) return {};
    const candidateRepo = `${owner}/${repoName}`;
    if (!REPO_PATTERN.test(candidateRepo)) return {};
    const result: ParsedGitHubTarget = { repo: candidateRepo };
    if (parts[2] === 'actions' && parts[3] === 'runs' && parts[4] && RUN_ID_PATTERN.test(parts[4])) {
      result.runId = parts[4];
    } else if (parts[2] === 'actions' && parts[3] === 'workflows' && parts[4] && WORKFLOW_PATTERN.test(parts[4])) {
      result.workflowFile = parts[4];
    }
    return result;
  } catch {
    const fallback: ParsedGitHubTarget = {};
    const repoMatch = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/.exec(rawUrl);
    if (repoMatch?.[1] && REPO_PATTERN.test(repoMatch[1])) {
      fallback.repo = repoMatch[1];
    }
    const runMatch = /\/actions\/runs\/(\d+)/.exec(rawUrl);
    if (runMatch?.[1] && RUN_ID_PATTERN.test(runMatch[1])) {
      fallback.runId = runMatch[1];
    }
    return fallback;
  }
}

function isKvLike(candidate: unknown): candidate is KvNamespaceLike {
  if (!candidate || typeof candidate !== 'object') return false;
  const rec = candidate as Record<string, unknown>;
  return typeof rec.get === 'function' && typeof rec.put === 'function';
}

function extractKvFromContext(ctx: { userId: string }): KvNamespaceLike | null {
  const raw = ctx as unknown as Record<string, unknown>;
  const directCandidates = [raw.kv, raw.store, raw.PET_KV, raw.KV];
  for (const item of directCandidates) {
    if (isKvLike(item)) return item;
  }
  if (raw.env && typeof raw.env === 'object') {
    const envRec = raw.env as Record<string, unknown>;
    for (const val of Object.values(envRec)) {
      if (isKvLike(val)) return val;
    }
  }
  return null;
}

function extractEnvString(ctx: { userId: string }, keys: string[]): string {
  const raw = ctx as unknown as Record<string, unknown>;
  for (const key of keys) {
    const direct = asTrimmedString(raw[key]);
    if (direct) return direct;
  }
  if (raw.env && typeof raw.env === 'object') {
    const envRec = raw.env as Record<string, unknown>;
    for (const key of keys) {
      const envVal = asTrimmedString(envRec[key]);
      if (envVal) return envVal;
    }
  }
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of keys) {
    const gVal = asTrimmedString(g[key]);
    if (gVal) return gVal;
  }
  return '';
}

function extractGeminiApiKey(ctx: { userId: string }, args: Record<string, unknown>): string {
  const fromArgs = asTrimmedString(args.gemini_api_key ?? args.api_key);
  if (fromArgs) return fromArgs;
  return extractEnvString(ctx, [
    'geminiApiKey',
    'apiKey',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_CLOUD_API_KEY',
    'GEMINI_KEY',
    'API_KEY',
  ]);
}

function extractGitHubToken(ctx: { userId: string }, args: Record<string, unknown>): string {
  const fromArgs = asTrimmedString(args.github_token);
  if (fromArgs) return fromArgs;
  return extractEnvString(ctx, ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT']);
}

function extractDefaultRepo(ctx: { userId: string }): string {
  const directRepo = extractEnvString(ctx, ['GITHUB_REPOSITORY', 'UPGRADE_REPO']);
  if (REPO_PATTERN.test(directRepo)) return directRepo;

  const owner = extractEnvString(ctx, ['GITHUB_OWNER']);
  const repoName = extractEnvString(ctx, ['GITHUB_REPO']);
  if (owner && repoName) {
    const combined = `${owner}/${repoName}`;
    if (REPO_PATTERN.test(combined)) return combined;
  }
  if (REPO_PATTERN.test(repoName)) {
    return repoName;
  }
  return DEFAULT_REPO;
}

function parseLogsInput(rawLogs: unknown): string[] {
  if (Array.isArray(rawLogs)) {
    const list: string[] = [];
    for (const item of rawLogs) {
      const s = asTrimmedString(item);
      if (s) list.push(s);
    }
    return list;
  }
  if (typeof rawLogs === 'string' && rawLogs.trim().length > 0) {
    return rawLogs
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }
  return [];
}

function normalizeKvUpgradeObject(raw: unknown): KvLatestUpgradeSnapshot | null {
  if (!raw) return null;
  let target: unknown = raw;
  if (typeof target === 'string') {
    const trimmed = target.trim();
    if (!trimmed || trimmed === '尚無升級紀錄') return null;
    try {
      target = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!target || typeof target !== 'object') return null;
  let obj = target as Record<string, unknown>;

  if (obj.result && typeof obj.result === 'string') {
    try {
      const inner = JSON.parse(obj.result) as unknown;
      if (inner && typeof inner === 'object') {
        obj = inner as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  } else if (obj.result && typeof obj.result === 'object') {
    obj = obj.result as Record<string, unknown>;
  }

  if (obj.latest_upgrade && typeof obj.latest_upgrade === 'object') {
    obj = obj.latest_upgrade as Record<string, unknown>;
  } else if (typeof obj.latest_upgrade === 'string') {
    return normalizeKvUpgradeObject(obj.latest_upgrade);
  }

  const status = asTrimmedString(obj.status ?? obj.upgrade_status);
  const step = asTrimmedString(obj.step ?? obj.upgrade_step);
  const request = asTrimmedString(obj.request);
  const summary = asTrimmedString(obj.summary ?? obj.upgrade_summary);
  const prUrl = asTrimmedString(obj.pr_url ?? obj.prUrl);
  const actionsUrl = asTrimmedString(obj.actions_url ?? obj.actionsUrl);
  const error = asTrimmedString(obj.error ?? obj.upgrade_error);
  const startedAt = asTrimmedString(obj.started_at ?? obj.startedAt) || null;
  const updatedAt = asTrimmedString(obj.updated_at ?? obj.updatedAt) || null;
  const logs = parseLogsInput(obj.logs ?? obj.upgrade_logs);
  const rawFiles = Array.isArray(obj.changed_files ?? obj.changedFiles)
    ? ((obj.changed_files ?? obj.changedFiles) as unknown[])
    : [];
  const changedFiles = rawFiles.map((f) => asTrimmedString(f)).filter((f) => f.length > 0);

  if (status.toLowerCase() === 'idle' && !actionsUrl && logs.length === 0 && !error) {
    return null;
  }
  if (!status && !step && !actionsUrl && logs.length === 0 && !error && !summary && !request) {
    return null;
  }

  return {
    status: status || 'running',
    step,
    request,
    summary,
    prUrl,
    actionsUrl,
    changedFiles,
    logs,
    error,
    startedAt,
    updatedAt,
  };
}

async function loadKvLatestUpgrade(
  userId: string,
  args: Record<string, unknown>,
  ctx: { userId: string }
): Promise<KvLatestUpgradeSnapshot | null> {
  let kvSnapshot: KvLatestUpgradeSnapshot | null = null;
  const rawCtx = ctx as unknown as Record<string, unknown>;

  if (rawCtx.latest_upgrade) {
    kvSnapshot = normalizeKvUpgradeObject(rawCtx.latest_upgrade);
  }

  if (!kvSnapshot && rawCtx.stateSvc && typeof rawCtx.stateSvc === 'object') {
    const svc = rawCtx.stateSvc as StateServiceLike;
    if (typeof svc.getUpgradeStatus === 'function') {
      try {
        const res = await svc.getUpgradeStatus(userId);
        kvSnapshot = normalizeKvUpgradeObject(res);
      } catch {
        // ignore stateSvc read error
      }
    }
  }

  if (!kvSnapshot) {
    const kv = extractKvFromContext(ctx);
    if (kv) {
      const candidateKeys = [`upgrade:${userId}`, `latest_upgrade:${userId}`, 'latest_upgrade', 'upgrade:default_user'];
      for (const k of candidateKeys) {
        try {
          const val = await kv.get(k);
          if (val) {
            const parsed = normalizeKvUpgradeObject(val);
            if (parsed) {
              kvSnapshot = parsed;
              break;
            }
          }
        } catch {
          // continue next key
        }
      }
    }
  }

  if (!kvSnapshot) {
    const redisUrl = extractEnvString(ctx, ['UPSTASH_REDIS_REST_URL']);
    const redisToken = extractEnvString(ctx, ['UPSTASH_REDIS_REST_TOKEN']);
    if (redisUrl && redisToken) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      try {
        const res = await fetch(redisUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${redisToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(['GET', `upgrade:${userId}`]),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { result?: unknown };
          kvSnapshot = normalizeKvUpgradeObject(data.result);
        }
      } catch {
        // ignore upstash network error
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const fromArgsObj = normalizeKvUpgradeObject(args.latest_upgrade);
  const explicitStatus = asTrimmedString(args.upgrade_status ?? args.status);
  const explicitStep = asTrimmedString(args.upgrade_step ?? args.step);
  const explicitActionsUrl = asTrimmedString(args.actions_url);
  const explicitPrUrl = asTrimmedString(args.pr_url);
  const explicitSummary = asTrimmedString(args.upgrade_summary ?? args.summary);
  const explicitError = asTrimmedString(args.upgrade_error ?? args.error);
  const explicitStartedAt = asTrimmedString(args.started_at ?? args.startedAt);
  const explicitUpdatedAt = asTrimmedString(args.updated_at ?? args.updatedAt);
  const explicitLogs = parseLogsInput(args.upgrade_logs ?? args.logs);

  const hasExplicitOverlay =
    fromArgsObj !== null ||
    explicitStatus !== '' ||
    explicitStep !== '' ||
    explicitActionsUrl !== '' ||
    explicitPrUrl !== '' ||
    explicitSummary !== '' ||
    explicitError !== '' ||
    explicitStartedAt !== '' ||
    explicitLogs.length > 0;

  if (!kvSnapshot && !hasExplicitOverlay) {
    return null;
  }

  const base = kvSnapshot ??
    fromArgsObj ?? {
      status: explicitStatus || 'running',
      step: explicitStep,
      request: '',
      summary: explicitSummary,
      prUrl: explicitPrUrl,
      actionsUrl: explicitActionsUrl,
      changedFiles: [],
      logs: [],
      error: explicitError,
      startedAt: explicitStartedAt || null,
      updatedAt: explicitUpdatedAt || null,
    };

  if (fromArgsObj && kvSnapshot) {
    if (fromArgsObj.status && fromArgsObj.status !== 'running') base.status = fromArgsObj.status;
    if (fromArgsObj.step) base.step = fromArgsObj.step;
    if (fromArgsObj.actionsUrl) {
      const pArg = parseGitHubActionsUrl(fromArgsObj.actionsUrl);
      const pBase = parseGitHubActionsUrl(base.actionsUrl);
      if (pArg.runId || !pBase.runId) {
        base.actionsUrl = fromArgsObj.actionsUrl;
      }
    }
    if (fromArgsObj.prUrl) base.prUrl = fromArgsObj.prUrl;
    if (fromArgsObj.summary) base.summary = fromArgsObj.summary;
    if (fromArgsObj.error) base.error = fromArgsObj.error;
    if (fromArgsObj.startedAt) base.startedAt = fromArgsObj.startedAt;
    if (fromArgsObj.updatedAt) base.updatedAt = fromArgsObj.updatedAt;
    for (const l of fromArgsObj.logs) {
      if (!base.logs.includes(l)) base.logs.push(l);
    }
  }

  if (explicitStatus) base.status = explicitStatus;
  if (explicitStep) base.step = explicitStep;
  if (explicitActionsUrl) {
    const pExp = parseGitHubActionsUrl(explicitActionsUrl);
    const pBase = parseGitHubActionsUrl(base.actionsUrl);
    if (pExp.runId || !pBase.runId) {
      base.actionsUrl = explicitActionsUrl;
    }
  }
  if (explicitPrUrl) base.prUrl = explicitPrUrl;
  if (explicitSummary) base.summary = explicitSummary;
  if (explicitError) base.error = explicitError;
  if (explicitStartedAt) base.startedAt = explicitStartedAt;
  if (explicitUpdatedAt) base.updatedAt = explicitUpdatedAt;
  for (const l of explicitLogs) {
    if (!base.logs.includes(l)) base.logs.push(l);
  }

  return base;
}

function analyzeKvLatestUpgrade(kv: KvLatestUpgradeSnapshot | null): KvUpgradeAnalysis {
  if (!kv) {
    return {
      hasKv: false,
      statusLower: 'idle',
      stepLower: '',
      isRejected: false,
      isCancelled: false,
      isTimedOut: false,
      isFailedOrCancelled: false,
      isMergedSuccess: false,
      isRunning: false,
      verdict: 'idle',
      reasons: [],
    };
  }

  const statusLower = kv.status.trim().toLowerCase();
  const stepLower = kv.step.trim().toLowerCase();
  const cleanError = isIgnorableLogAccessWarning(kv.error) ? '' : kv.error.trim();
  const cleanLogs = kv.logs.map((l) => l.trim()).filter((l) => l.length > 0 && !isIgnorableLogAccessWarning(l));

  const rejectionLines = cleanLogs.filter((l) => REJECTION_KEYWORD_PATTERN.test(l));
  const codeErrorLines = cleanLogs.filter((l) => KV_CODE_ERROR_PATTERN.test(l));
  const generalFailLines = cleanLogs.filter((l) =>
    /(?:^|\s)(?:❌|🚫|⚠️|錯誤[:：]|失敗[:：]|拒絕原因[:：]|Execution failed|Process completed with exit code [1-9])/i.test(l)
  );
  const hasMergedLog = cleanLogs.some((l) => KV_MERGE_SUCCESS_PATTERN.test(l));

  const isRejected =
    statusLower === 'rejected' ||
    stepLower === 'rejected' ||
    REJECTION_KEYWORD_PATTERN.test(cleanError) ||
    rejectionLines.length > 0;

  const isCancelled =
    statusLower === 'cancelled' ||
    statusLower === 'canceled' ||
    stepLower === 'cancelled' ||
    stepLower === 'canceled';

  const isTimedOut = statusLower === 'timed_out' || stepLower === 'timed_out';

  const isFailedStatus =
    statusLower === 'failed' ||
    statusLower === 'error' ||
    stepLower === 'failed' ||
    stepLower === 'error';

  const isFailedOrCancelled =
    isRejected ||
    isCancelled ||
    isTimedOut ||
    isFailedStatus ||
    codeErrorLines.length > 0 ||
    cleanError.length > 0;

  const isMergedSuccess =
    !isFailedOrCancelled &&
    (statusLower === 'merged' || stepLower === 'merged' || hasMergedLog);

  const isRunning =
    !isFailedOrCancelled &&
    !isMergedSuccess &&
    (isInProgressStatus(statusLower) || statusLower === '');

  const reasons: string[] = [];
  const pushReason = (r: string) => {
    const trimmed = r.trim();
    if (trimmed && !isIgnorableLogAccessWarning(trimmed) && !reasons.includes(trimmed)) {
      reasons.push(trimmed);
    }
  };

  if (cleanError) pushReason(cleanError);
  for (const line of rejectionLines) pushReason(line);
  for (const line of codeErrorLines) pushReason(line);
  for (const line of generalFailLines) pushReason(line);
  if (isFailedOrCancelled && reasons.length === 0 && kv.step && !isInProgressStatus(kv.step) && stepLower !== 'merged') {
    pushReason(`停在階段：${kv.step}`);
  }

  let verdict: KvUpgradeAnalysis['verdict'] = 'running';
  if (isRejected) verdict = 'rejected';
  else if (isCancelled) verdict = 'cancelled';
  else if (isTimedOut) verdict = 'timed_out';
  else if (isFailedOrCancelled) verdict = 'failure';
  else if (isMergedSuccess) verdict = 'success';
  else if (isRunning) verdict = 'running';
  else verdict = 'idle';

  return {
    hasKv: true,
    statusLower,
    stepLower,
    isRejected,
    isCancelled,
    isTimedOut,
    isFailedOrCancelled,
    isMergedSuccess,
    isRunning,
    verdict,
    reasons: reasons.slice(0, 6),
  };
}

async function generateAiCareSentence(
  rule: ProactiveRule,
  localTimeInfo: { dateStr: string; timeStr: string },
  ctx: { userId: string },
  args: Record<string, unknown>
): Promise<{ message: string; aiGeneratedSuccess: boolean }> {
  const fallbackMessage = rule.message || rule.title || '主人～記得休息一下喔！🐾';
  const apiKey = extractGeminiApiKey(ctx, args);
  if (!apiKey) {
    return { message: fallbackMessage, aiGeneratedSuccess: false };
  }

  const scheduleLabel =
    rule.scheduleType === 'daily'
      ? `每日定時 (${rule.time})`
      : rule.scheduleType === 'interval'
        ? `每 ${rule.intervalMinutes} 分鐘週期提醒`
        : `閒置滿 ${rule.intervalMinutes} 分鐘關懷`;

  const prompt = [
    '你是一隻溫暖、貼心、有活力的 AI 桌寵，正在主動關心主人。',
    `目前時間：${localTimeInfo.dateStr} ${localTimeInfo.timeStr}`,
    `關懷類型：${scheduleLabel}`,
    `主題標題：${rule.title}`,
    `參考提示或備用句子：${fallbackMessage}`,
    '請根據上述主題與參考提示，即時創作一句自然可愛、符合桌寵性格且不重複的繁體中文主動關懷句子（約 20～60 字，可搭配 1～2 個貼切 Emoji）。',
    '請直接輸出那句給主人的話，不要加上引號或任何額外說明。',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 150,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { message: fallbackMessage, aiGeneratedSuccess: false };
    }

    const data = (await res.json()) as GeminiGenerateContentResponse;
    const firstCandidate = Array.isArray(data.candidates) ? data.candidates[0] : undefined;
    const parts = firstCandidate?.content?.parts;
    const firstPart = Array.isArray(parts) ? parts[0] : undefined;
    const generatedText = asTrimmedString(firstPart?.text);

    if (generatedText.length > 0) {
      return { message: generatedText, aiGeneratedSuccess: true };
    }
    return { message: fallbackMessage, aiGeneratedSuccess: false };
  } catch {
    return { message: fallbackMessage, aiGeneratedSuccess: false };
  } finally {
    clearTimeout(timer);
  }
}

function getWorkersCache(): CacheLike | null {
  const g = globalThis as unknown as {
    caches?: { default?: CacheLike };
  };
  if (g.caches && g.caches.default) {
    return g.caches.default;
  }
  return null;
}

function buildStorageKey(userId: string): string {
  return `pet_proactive_messages_v1:${userId || 'default'}`;
}

function buildCacheUrl(userId: string): string {
  return `https://proactive-store.internal/v1/${encodeURIComponent(userId || 'default')}`;
}

function createDefaultUpgradeTracking(): UpgradeTrackingState {
  return {
    tracking: false,
    repo: '',
    workflowFile: DEFAULT_WORKFLOW_FILE,
    runId: '',
    actionsUrl: '',
    prUrl: '',
    summary: '',
    lastKnownStatus: 'idle',
    lastKnownConclusion: null,
    lastKnownError: '',
    reported: false,
    reportedRunKeys: [],
    startedAt: null,
    lastCheckedAt: null,
    reportedAt: null,
  };
}

function sanitizeUpgradeTracking(raw: unknown): UpgradeTrackingState {
  const fallback = createDefaultUpgradeTracking();
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;
  const rawKeys = Array.isArray(obj.reportedRunKeys) ? obj.reportedRunKeys : [];
  const reportedRunKeys: string[] = [];
  for (const k of rawKeys.slice(-20)) {
    const str = asTrimmedString(k);
    if (str) reportedRunKeys.push(str);
  }
  const rawActionsUrl = asTrimmedString(obj.actionsUrl);
  const parsedUrl = parseGitHubActionsUrl(rawActionsUrl);
  const explicitRunId = asTrimmedString(obj.runId);
  return {
    tracking: asBoolean(obj.tracking, false),
    repo: asTrimmedString(obj.repo) || parsedUrl.repo || '',
    workflowFile: asTrimmedString(obj.workflowFile) || parsedUrl.workflowFile || DEFAULT_WORKFLOW_FILE,
    runId: explicitRunId || parsedUrl.runId || '',
    actionsUrl: rawActionsUrl,
    prUrl: asTrimmedString(obj.prUrl),
    summary: asTrimmedString(obj.summary),
    lastKnownStatus: asTrimmedString(obj.lastKnownStatus) || 'idle',
    lastKnownConclusion: asTrimmedString(obj.lastKnownConclusion) || null,
    lastKnownError: asTrimmedString(obj.lastKnownError),
    reported: asBoolean(obj.reported, false),
    reportedRunKeys,
    startedAt: asTrimmedString(obj.startedAt) || null,
    lastCheckedAt: asTrimmedString(obj.lastCheckedAt) || null,
    reportedAt: asTrimmedString(obj.reportedAt) || null,
  };
}

function createDefaultRules(nowIso: string): ProactiveRule[] {
  return [
    {
      id: 'daily-morning',
      title: '每日早安問候',
      message: '早安主人！新的一天開始囉，今天有什麼計畫想跟我分享嗎？☀️',
      scheduleType: 'daily',
      time: '09:00',
      intervalMinutes: 60,
      enabled: true,
      aiGenerated: false,
      createdAt: nowIso,
      lastTriggeredAt: null,
    },
    {
      id: 'idle-care',
      title: '閒置關懷提醒',
      message: '主人忙了好一陣子呢，記得站起來伸個懶腰、喝口水休息一下喔！🐾',
      scheduleType: 'idle',
      time: '00:00',
      intervalMinutes: 120,
      enabled: true,
      aiGenerated: false,
      createdAt: nowIso,
      lastTriggeredAt: null,
    },
  ];
}

function createInitialStore(userId: string): ProactiveUserStore {
  const nowIso = new Date().toISOString();
  return {
    userId,
    globalEnabled: true,
    timezone: DEFAULT_TIMEZONE,
    lastInteractionAt: nowIso,
    updatedAt: nowIso,
    rules: createDefaultRules(nowIso),
    upgradeTracking: createDefaultUpgradeTracking(),
  };
}

function sanitizeStore(raw: unknown, userId: string): ProactiveUserStore {
  if (!raw || typeof raw !== 'object') {
    return createInitialStore(userId);
  }
  const obj = raw as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const rawRules = Array.isArray(obj.rules) ? obj.rules : [];
  const rules: ProactiveRule[] = [];

  for (const item of rawRules) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = asTrimmedString(r.id) || crypto.randomUUID().slice(0, 8);
    const scheduleType = normalizeScheduleType(asTrimmedString(r.scheduleType), true, false);
    const title = asTrimmedString(r.title) || '主動關懷提醒';
    const message = asTrimmedString(r.message) || title;
    const time = normalizeTime(asTrimmedString(r.time), '09:00');
    const intervalMinutes = asPositiveInt(r.intervalMinutes, 60);
    const enabled = asBoolean(r.enabled, true);
    const aiGenerated = asBoolean(r.aiGenerated ?? r.ai_generated, false);
    const createdAt = asTrimmedString(r.createdAt) || nowIso;
    const lastTriggeredAt = asTrimmedString(r.lastTriggeredAt) || null;
    rules.push({
      id,
      title,
      message,
      scheduleType,
      time,
      intervalMinutes,
      enabled,
      aiGenerated,
      createdAt,
      lastTriggeredAt,
    });
  }

  return {
    userId: asTrimmedString(obj.userId) || userId,
    globalEnabled: asBoolean(obj.globalEnabled, true),
    timezone: asTrimmedString(obj.timezone) || DEFAULT_TIMEZONE,
    lastInteractionAt: asTrimmedString(obj.lastInteractionAt) || nowIso,
    updatedAt: asTrimmedString(obj.updatedAt) || nowIso,
    rules,
    upgradeTracking: sanitizeUpgradeTracking(obj.upgradeTracking),
  };
}

async function loadUserStore(userId: string, ctx: { userId: string }): Promise<ProactiveUserStore> {
  const key = buildStorageKey(userId);
  const kv = extractKvFromContext(ctx);
  if (kv) {
    try {
      const rawText = await kv.get(key);
      if (rawText) {
        const parsed = sanitizeStore(JSON.parse(rawText), userId);
        MEMORY_STORE.set(userId, parsed);
        return parsed;
      }
    } catch {
      // fallback to cache or memory
    }
  }

  const cache = getWorkersCache();
  if (cache) {
    try {
      const cachedRes = await cache.match(buildCacheUrl(userId));
      if (cachedRes) {
        const rawText = await cachedRes.text();
        const parsed = sanitizeStore(JSON.parse(rawText), userId);
        MEMORY_STORE.set(userId, parsed);
        return parsed;
      }
    } catch {
      // fallback to memory
    }
  }

  const existing = MEMORY_STORE.get(userId);
  if (existing) {
    return existing;
  }

  const initial = createInitialStore(userId);
  await saveUserStore(initial, ctx);
  return initial;
}

async function saveUserStore(store: ProactiveUserStore, ctx: { userId: string }): Promise<void> {
  store.updatedAt = new Date().toISOString();
  store.upgradeTracking.reportedRunKeys = store.upgradeTracking.reportedRunKeys.slice(-20);
  MEMORY_STORE.set(store.userId, store);
  const serialized = JSON.stringify(store);

  const cache = getWorkersCache();
  if (cache) {
    try {
      const res = new Response(serialized, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=31536000',
        },
      });
      await cache.put(buildCacheUrl(store.userId), res);
    } catch {
      // ignore cache write failure
    }
  }

  const kv = extractKvFromContext(ctx);
  if (kv) {
    try {
      await kv.put(buildStorageKey(store.userId), serialized);
    } catch {
      // ignore kv write failure
    }
  }
}

function getZonedDateTime(date: Date, timeZone: string): { dateStr: string; timeStr: string; minutesOfDay: number } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = p.value;
    }
  }
  const year = map.year ?? '1970';
  const month = (map.month ?? '01').padStart(2, '0');
  const day = (map.day ?? '01').padStart(2, '0');
  const rawHour = Number(map.hour ?? '0');
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(map.minute ?? '0');

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return {
    dateStr: `${year}-${month}-${day}`,
    timeStr: `${hh}:${mm}`,
    minutesOfDay: hour * 60 + minute,
  };
}

function parseTimeToMinutes(timeStr: string): number {
  const normalized = normalizeTime(timeStr, '09:00');
  const [hh, mm] = normalized.split(':');
  return Number(hh ?? 9) * 60 + Number(mm ?? 0);
}

function isInProgressStatus(status: string): boolean {
  const lower = status.trim().toLowerCase();
  return (
    lower === 'running' ||
    lower === 'in_progress' ||
    lower === 'queued' ||
    lower === 'waiting' ||
    lower === 'pending' ||
    lower === 'requested' ||
    lower === 'pr_created'
  );
}

function hasRunKeyBeenReported(reportedRunKeys: string[], keyPrefix: string): boolean {
  if (!keyPrefix) return false;
  return reportedRunKeys.some((k) => k === keyPrefix || k.startsWith(`${keyPrefix}:`));
}

function syncTrackingFromKvAndArgs(
  store: ProactiveUserStore,
  kvLatest: KvLatestUpgradeSnapshot | null,
  args: Record<string, unknown>,
  ctx: { userId: string },
  nowIso: string,
  forceRegister: boolean
): { registered: boolean; alreadyReported: boolean; changed: boolean } {
  const track = store.upgradeTracking;
  let changed = false;

  const rawArgUrl = asTrimmedString(args.actions_url);
  const rawKvUrl = kvLatest?.actionsUrl || '';
  const parsedArgUrl = parseGitHubActionsUrl(rawArgUrl);
  const parsedKvUrl = parseGitHubActionsUrl(rawKvUrl);
  const parsedTrackUrl = parseGitHubActionsUrl(track.actionsUrl);

  const explicitRunId = asTrimmedString(args.run_id);
  const candidateRunId =
    explicitRunId ||
    parsedArgUrl.runId ||
    parsedKvUrl.runId ||
    parsedTrackUrl.runId ||
    track.runId ||
    '';

  const resolvedRepo =
    asTrimmedString(args.repo) ||
    parsedArgUrl.repo ||
    parsedKvUrl.repo ||
    track.repo ||
    parsedTrackUrl.repo ||
    extractDefaultRepo(ctx);

  const resolvedWorkflow =
    asTrimmedString(args.workflow_file) ||
    parsedArgUrl.workflowFile ||
    parsedKvUrl.workflowFile ||
    track.workflowFile ||
    parsedTrackUrl.workflowFile ||
    DEFAULT_WORKFLOW_FILE;

  const resolvedActionsUrl =
    (parsedArgUrl.runId ? rawArgUrl : '') ||
    (parsedKvUrl.runId ? rawKvUrl : '') ||
    rawArgUrl ||
    rawKvUrl ||
    track.actionsUrl;

  const resolvedPrUrl = asTrimmedString(args.pr_url) || kvLatest?.prUrl || track.prUrl;
  const resolvedSummary =
    asTrimmedString(args.upgrade_summary ?? args.summary ?? args.title) ||
    kvLatest?.summary ||
    kvLatest?.request ||
    track.summary;
  const resolvedStartedAt =
    asTrimmedString(args.started_at ?? args.startedAt) ||
    kvLatest?.startedAt ||
    track.startedAt ||
    (forceRegister ? nowIso : null);

  const explicitError = asTrimmedString(args.upgrade_error ?? args.error) || kvLatest?.error || '';
  const cleanExplicitError = isIgnorableLogAccessWarning(explicitError) ? '' : explicitError;

  const isAlreadyReportedForRun =
    candidateRunId !== '' && hasRunKeyBeenReported(track.reportedRunKeys, candidateRunId);
  const isAlreadyReportedForStart =
    candidateRunId === '' &&
    resolvedStartedAt !== null &&
    hasRunKeyBeenReported(track.reportedRunKeys, resolvedStartedAt);

  if (forceRegister && (isAlreadyReportedForRun || isAlreadyReportedForStart)) {
    return { registered: false, alreadyReported: true, changed: false };
  }

  const isNewSpecificRun = candidateRunId !== '' && candidateRunId !== track.runId && !isAlreadyReportedForRun;
  const isNewStartSession =
    candidateRunId === '' &&
    kvLatest?.startedAt != null &&
    kvLatest.startedAt !== track.startedAt &&
    !hasRunKeyBeenReported(track.reportedRunKeys, kvLatest.startedAt);

  if (forceRegister || isNewSpecificRun || isNewStartSession || (!track.tracking && kvLatest && !isAlreadyReportedForRun && !isAlreadyReportedForStart)) {
    track.tracking = true;
    track.reported = false;
    track.reportedAt = null;
    track.lastKnownConclusion = null;
    changed = true;
  }

  if (resolvedRepo && track.repo !== resolvedRepo) {
    track.repo = resolvedRepo;
    changed = true;
  }
  if (resolvedWorkflow && track.workflowFile !== resolvedWorkflow) {
    track.workflowFile = resolvedWorkflow;
    changed = true;
  }
  if (candidateRunId && track.runId !== candidateRunId) {
    track.runId = candidateRunId;
    changed = true;
  } else if (forceRegister && explicitRunId === '' && !parsedArgUrl.runId && !parsedKvUrl.runId && isNewStartSession) {
    track.runId = '';
    changed = true;
  }
  if (resolvedActionsUrl && track.actionsUrl !== resolvedActionsUrl) {
    track.actionsUrl = resolvedActionsUrl;
    changed = true;
  }
  if (resolvedPrUrl && track.prUrl !== resolvedPrUrl) {
    track.prUrl = resolvedPrUrl;
    changed = true;
  }
  if (resolvedSummary && track.summary !== resolvedSummary) {
    track.summary = resolvedSummary;
    changed = true;
  }
  if (resolvedStartedAt && track.startedAt !== resolvedStartedAt) {
    track.startedAt = resolvedStartedAt;
    changed = true;
  }
  if (cleanExplicitError && track.lastKnownError !== cleanExplicitError) {
    track.lastKnownError = cleanExplicitError;
    changed = true;
  }

  const rawStatus = asTrimmedString(args.upgrade_status ?? args.status) || kvLatest?.status || track.lastKnownStatus || 'running';
  const lowerStatus = rawStatus.toLowerCase();
  if (
    lowerStatus === 'rejected' ||
    lowerStatus === 'failed' ||
    lowerStatus === 'error' ||
    lowerStatus === 'cancelled' ||
    lowerStatus === 'canceled' ||
    lowerStatus === 'timed_out' ||
    lowerStatus === 'merged'
  ) {
    if (track.lastKnownStatus !== lowerStatus) {
      track.lastKnownStatus = lowerStatus;
      changed = true;
    }
  } else if (track.tracking && !track.reported) {
    const nextInProgress = isInProgressStatus(rawStatus) ? rawStatus : 'running';
    if (track.lastKnownStatus !== nextInProgress) {
      track.lastKnownStatus = nextInProgress;
      changed = true;
    }
  }

  return { registered: track.tracking, alreadyReported: false, changed };
}

function extractUpgradeFailureDetails(jobsRaw: unknown): {
  failedSteps: string[];
  annotationsSummary: string[];
  errorReasons: string[];
  isRejected: boolean;
} {
  const failedSteps: string[] = [];
  const annotationsSummary: string[] = [];
  const errorReasons: string[] = [];
  const jobs = Array.isArray(jobsRaw) ? jobsRaw : [];

  for (const jobItem of jobs) {
    if (!jobItem || typeof jobItem !== 'object') continue;
    const job = jobItem as Record<string, unknown>;
    const jobName = asTrimmedString(job.name) || 'Job';

    const rawFailedSteps = Array.isArray(job.failed_steps) ? job.failed_steps : [];
    const fallbackSteps = Array.isArray(job.steps) ? job.steps : [];
    const stepCandidates = rawFailedSteps.length > 0 ? rawFailedSteps : fallbackSteps;

    for (const stItem of stepCandidates) {
      if (!stItem || typeof stItem !== 'object') continue;
      const st = stItem as Record<string, unknown>;
      const stConcl = asTrimmedString(st.conclusion).toLowerCase();
      if (
        rawFailedSteps.length === 0 &&
        stConcl !== 'failure' &&
        stConcl !== 'cancelled' &&
        stConcl !== 'canceled' &&
        stConcl !== 'timed_out' &&
        stConcl !== 'action_required'
      ) {
        continue;
      }
      const stName = asTrimmedString(st.name) || '步驟';
      const stepLabel = `${jobName} > ${stName} (${stConcl || 'failure'})`;
      if (!failedSteps.includes(stepLabel)) {
        failedSteps.push(stepLabel);
      }
    }

    const annotations = Array.isArray(job.annotations) ? job.annotations : [];
    for (const annItem of annotations.slice(0, 8)) {
      if (!annItem || typeof annItem !== 'object') continue;
      const ann = annItem as Record<string, unknown>;
      const msg = asTrimmedString(ann.message);
      if (!msg || isIgnorableLogAccessWarning(msg)) continue;
      const level = asTrimmedString(ann.level ?? ann.annotation_level);
      const annTitle = asTrimmedString(ann.title);
      const filePath = asTrimmedString(ann.path);
      const lineNum = typeof ann.start_line === 'number' ? `:${ann.start_line}` : '';
      const loc = filePath ? `${filePath}${lineNum} ` : '';
      const head = level ? `[${level}] ` : '';
      const titlePart = annTitle ? `${annTitle}: ` : '';
      const formatted = `${head}${loc}${titlePart}${msg}`.trim();
      if (!isIgnorableLogAccessWarning(formatted) && !annotationsSummary.includes(formatted)) {
        annotationsSummary.push(formatted);
      }
    }

    const errorLines = Array.isArray(job.error_lines) ? job.error_lines : [];
    for (const line of errorLines.slice(0, 6)) {
      const trimmed = asTrimmedString(line);
      if (trimmed && !isIgnorableLogAccessWarning(trimmed) && !errorReasons.includes(trimmed)) {
        errorReasons.push(trimmed);
      }
    }

    if (errorReasons.length === 0) {
      const logTail = asTrimmedString(job.log_tail);
      if (logTail && !isIgnorableLogAccessWarning(logTail)) {
        const tailLines = logTail
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !isIgnorableLogAccessWarning(l));
        for (const tl of tailLines.slice(-3)) {
          if (!errorReasons.includes(tl)) {
            errorReasons.push(tl);
          }
        }
      }
    }
  }

  for (const ann of annotationsSummary) {
    if (!isIgnorableLogAccessWarning(ann) && !errorReasons.includes(ann)) {
      errorReasons.push(ann);
    }
  }
  if (errorReasons.length === 0) {
    for (const st of failedSteps) {
      if (!errorReasons.includes(st)) {
        errorReasons.push(st);
      }
    }
  }

  const isRejected =
    failedSteps.some((s) => REJECTION_KEYWORD_PATTERN.test(s)) ||
    annotationsSummary.some((a) => REJECTION_KEYWORD_PATTERN.test(a)) ||
    errorReasons.some((r) => REJECTION_KEYWORD_PATTERN.test(r));

  return {
    failedSteps: failedSteps.slice(0, 8),
    annotationsSummary: annotationsSummary.slice(0, 6),
    errorReasons: errorReasons.slice(0, 6),
    isRejected,
  };
}

function buildUpgradeNotificationItem(params: {
  verdict: string;
  isSuccess: boolean;
  isRejected: boolean;
  runId: string;
  runNumberLabel: string;
  runStatus: string;
  runConclusion: string;
  actionsUrl: string;
  prUrl: string;
  summaryLabel: string;
  failedSteps: string[];
  annotationsSummary: string[];
  errorReasons: string[];
  nowIso: string;
  nowMs: number;
}): DueNotificationItem {
  const {
    verdict,
    isSuccess,
    isRejected,
    runId,
    runNumberLabel,
    runStatus,
    runConclusion,
    actionsUrl,
    prUrl,
    summaryLabel,
    failedSteps,
    annotationsSummary,
    errorReasons,
    nowIso,
    nowMs,
  } = params;

  const cleanReasons = errorReasons.filter((r) => !isIgnorableLogAccessWarning(r));
  const cleanAnnotations = annotationsSummary.filter((a) => !isIgnorableLogAccessWarning(a));
  const runTag = runNumberLabel ? `（GitHub Actions ${runNumberLabel}）` : '';

  let title = '';
  let message = '';

  if (isSuccess) {
    title = '🎉 自我升級完成通知';
    const parts: string[] = [
      `主人好消息！我的自我升級「${summaryLabel}」${runTag}已經順利完成囉！✨`,
    ];
    if (prUrl) parts.push(`PR 變更連結：${prUrl}`);
    if (actionsUrl) parts.push(`Actions 執行紀錄：${actionsUrl}`);
    message = parts.join('\n');
  } else {
    if (isRejected) {
      title = '🚫 自我升級被拒絕通知';
    } else if (verdict === 'cancelled') {
      title = '⚠️ 自我升級已取消通知';
    } else if (verdict === 'timed_out') {
      title = '⏱️ 自我升級逾時通知';
    } else {
      title = '❌ 自我升級失敗通知';
    }

    const headerLine = isRejected
      ? `主人注意：我的自我升級「${summaryLabel}」${runTag}已被安全閘門拒絕（rejected）。`
      : verdict === 'cancelled'
        ? `主人注意：我的自我升級「${summaryLabel}」${runTag}已取消／未能完成（狀態：${runStatus} / 結論：cancelled）。`
        : `主人注意：我的自我升級「${summaryLabel}」${runTag}未能成功（狀態：${runStatus} / 結論：${verdict}）。`;

    const parts: string[] = [headerLine];
    if (failedSteps.length > 0) {
      parts.push(`失敗步驟：${failedSteps.join('；')}`);
    }
    if (cleanAnnotations.length > 0) {
      parts.push(`Annotations 摘要：${cleanAnnotations.slice(0, 3).join(' | ')}`);
    }
    if (cleanReasons.length > 0) {
      parts.push(`失敗/拒絕原因：${cleanReasons.slice(0, 3).join(' | ')}`);
    }
    if (actionsUrl) {
      parts.push(`Actions 連結：${actionsUrl}`);
    }
    message = parts.join('\n');
  }

  return {
    id: `upgrade-${runId || nowMs}`,
    title,
    message,
    scheduleType: 'interval',
    time: '00:00',
    intervalMinutes: 1,
    enabled: true,
    aiGenerated: false,
    createdAt: nowIso,
    lastTriggeredAt: nowIso,
    originalMessage: message,
    aiGeneratedSuccess: false,
    upgradeReport: {
      verdict,
      runId,
      status: runStatus,
      conclusion: runConclusion || verdict,
      actionsUrl,
      prUrl,
      failedSteps,
      annotationsSummary: cleanAnnotations,
      errorReasons: cleanReasons.slice(0, 6),
    },
  };
}

async function checkTrackedUpgradeProgress(
  store: ProactiveUserStore,
  kvLatest: KvLatestUpgradeSnapshot | null,
  args: Record<string, unknown>,
  ctx: { userId: string },
  nowIso: string,
  nowMs: number
): Promise<{ notification: DueNotificationItem | null; changed: boolean }> {
  const syncRes = syncTrackingFromKvAndArgs(store, kvLatest, args, ctx, nowIso, false);
  const track = store.upgradeTracking;
  let changed = syncRes.changed;

  if (!track.tracking || track.reported) {
    return { notification: null, changed };
  }

  const kvAnalysis = analyzeKvLatestUpgrade(kvLatest);
  const explicitStatus = asTrimmedString(args.upgrade_status ?? args.status).toLowerCase();
  const explicitErrorRaw = asTrimmedString(args.upgrade_error ?? args.error) || track.lastKnownError;
  const cleanExplicitError = isIgnorableLogAccessWarning(explicitErrorRaw) ? '' : explicitErrorRaw;

  const isExplicitRejected =
    explicitStatus === 'rejected' ||
    track.lastKnownStatus.toLowerCase() === 'rejected' ||
    REJECTION_KEYWORD_PATTERN.test(cleanExplicitError);
  const isExplicitCancelled =
    explicitStatus === 'cancelled' ||
    explicitStatus === 'canceled' ||
    track.lastKnownStatus.toLowerCase() === 'cancelled' ||
    track.lastKnownStatus.toLowerCase() === 'canceled';
  const isExplicitTimedOut =
    explicitStatus === 'timed_out' || track.lastKnownStatus.toLowerCase() === 'timed_out';
  const isExplicitFailed =
    isExplicitRejected ||
    isExplicitCancelled ||
    isExplicitTimedOut ||
    explicitStatus === 'failed' ||
    explicitStatus === 'error' ||
    track.lastKnownStatus.toLowerCase() === 'failed' ||
    track.lastKnownStatus.toLowerCase() === 'error';

  const combinedKvFailed = kvAnalysis.isFailedOrCancelled || isExplicitFailed;
  const combinedKvRejected = kvAnalysis.isRejected || isExplicitRejected;
  const combinedKvCancelled = kvAnalysis.isCancelled || isExplicitCancelled;
  const combinedKvTimedOut = kvAnalysis.isTimedOut || isExplicitTimedOut;
  const combinedKvReasons: string[] = [...kvAnalysis.reasons];
  if (cleanExplicitError && !combinedKvReasons.includes(cleanExplicitError)) {
    combinedKvReasons.unshift(cleanExplicitError);
  }

  const repo =
    track.repo ||
    asTrimmedString(args.repo) ||
    parseGitHubActionsUrl(track.actionsUrl).repo ||
    extractDefaultRepo(ctx);

  let ghRes: Record<string, unknown> | null = null;
  if (repo) {
    const githubToken = extractGitHubToken(ctx, args);
    const ghArgs: Record<string, unknown> = {
      repo,
      workflow_file: track.workflowFile || DEFAULT_WORKFLOW_FILE,
    };
    if (track.actionsUrl) ghArgs.actions_url = track.actionsUrl;
    if (track.runId) ghArgs.run_id = track.runId;
    if (githubToken) ghArgs.github_token = githubToken;
    ghRes = await githubActionsUpgradeStatusPlugin.execute(ghArgs, ctx);
    track.lastCheckedAt = nowIso;
    changed = true;
  }

  // 驗證 GitHub Actions API 回傳是否成功，且是否對應本次任務而非舊歷史 run
  let matchedRun: Record<string, unknown> | null = null;
  const ghApiSucceeded = Boolean(ghRes && ghRes.ok === true && ghRes.run && typeof ghRes.run === 'object');

  if (ghApiSucceeded && ghRes) {
    const candidateRun = ghRes.run as Record<string, unknown>;
    const candidateRunId = String(candidateRun.id ?? '');
    const hadBoundRunId = track.runId !== '';

    if (hadBoundRunId && candidateRunId === track.runId) {
      matchedRun = candidateRun;
    } else if (!hadBoundRunId && candidateRunId) {
      const alreadyReportedThisId = hasRunKeyBeenReported(track.reportedRunKeys, candidateRunId);
      const refStartStr = kvLatest?.startedAt || track.startedAt || '';
      const refStartMs = refStartStr ? Date.parse(refStartStr) : Number.NaN;
      const runUpdatedStr = asTrimmedString(candidateRun.updated_at) || asTrimmedString(candidateRun.created_at);
      const runCreatedStr = asTrimmedString(candidateRun.created_at) || runUpdatedStr;
      const runUpdatedMs = runUpdatedStr ? Date.parse(runUpdatedStr) : Number.NaN;
      const runCreatedMs = runCreatedStr ? Date.parse(runCreatedStr) : Number.NaN;

      const isStaleHistoricalRun =
        alreadyReportedThisId ||
        (Number.isFinite(refStartMs) &&
          ((Number.isFinite(runUpdatedMs) && runUpdatedMs < refStartMs - 60000) ||
            (Number.isFinite(runCreatedMs) &&
              asTrimmedString(candidateRun.status).toLowerCase() === 'completed' &&
              runCreatedMs < refStartMs - 60000)));

      if (!isStaleHistoricalRun) {
        matchedRun = candidateRun;
        track.runId = candidateRunId;
        const htmlUrl = asTrimmedString(candidateRun.html_url);
        if (htmlUrl) track.actionsUrl = htmlUrl;
      }
    } else if (candidateRunId) {
      matchedRun = candidateRun;
    }
  }

  // 降級容錯分支：當 GitHub Actions API 查詢失敗 (ok: false 或 HTTP 403 rate limit) 或尚未抓到對應新 run 時
  // 絕對不可誤報升級失敗，僅依據 KV latest_upgrade 判斷；若 KV 仍為 running 則維持進行中等待下次 check_due
  if (!matchedRun) {
    if (combinedKvFailed) {
      const fallbackVerdict = combinedKvRejected
        ? 'rejected'
        : combinedKvCancelled
          ? 'cancelled'
          : combinedKvTimedOut
            ? 'timed_out'
            : 'failure';
      const keyBase = track.runId || track.startedAt || 'latest';
      const reportKey = `${keyBase}:${fallbackVerdict}`;
      if (track.reportedRunKeys.includes(reportKey) || (track.runId && hasRunKeyBeenReported(track.reportedRunKeys, track.runId))) {
        track.tracking = false;
        track.reported = true;
        return { notification: null, changed: true };
      }

      const summaryLabel = track.summary || kvLatest?.summary || kvLatest?.request || '自我升級任務';
      const runNumberLabel = track.runId ? `#${track.runId}` : '';

      track.tracking = false;
      track.reported = true;
      track.lastKnownStatus = fallbackVerdict;
      track.lastKnownConclusion = fallbackVerdict;
      track.reportedAt = nowIso;
      track.reportedRunKeys.push(reportKey);

      return {
        notification: buildUpgradeNotificationItem({
          verdict: fallbackVerdict,
          isSuccess: false,
          isRejected: combinedKvRejected,
          runId: track.runId,
          runNumberLabel,
          runStatus: kvAnalysis.statusLower || fallbackVerdict,
          runConclusion: fallbackVerdict,
          actionsUrl: track.actionsUrl,
          prUrl: track.prUrl,
          summaryLabel,
          failedSteps: [],
          annotationsSummary: [],
          errorReasons: combinedKvReasons,
          nowIso,
          nowMs,
        }),
        changed: true,
      };
    }

    if (kvAnalysis.isMergedSuccess) {
      const keyBase = track.runId || track.startedAt || 'latest';
      const reportKey = `${keyBase}:success`;
      if (track.reportedRunKeys.includes(reportKey) || (track.runId && hasRunKeyBeenReported(track.reportedRunKeys, track.runId))) {
        track.tracking = false;
        track.reported = true;
        return { notification: null, changed: true };
      }

      const summaryLabel = track.summary || kvLatest?.summary || kvLatest?.request || '自我升級任務';
      const runNumberLabel = track.runId ? `#${track.runId}` : '';

      track.tracking = false;
      track.reported = true;
      track.lastKnownStatus = 'completed';
      track.lastKnownConclusion = 'success';
      track.reportedAt = nowIso;
      track.reportedRunKeys.push(reportKey);

      return {
        notification: buildUpgradeNotificationItem({
          verdict: 'success',
          isSuccess: true,
          isRejected: false,
          runId: track.runId,
          runNumberLabel,
          runStatus: 'merged',
          runConclusion: 'success',
          actionsUrl: track.actionsUrl,
          prUrl: track.prUrl,
          summaryLabel,
          failedSteps: [],
          annotationsSummary: [],
          errorReasons: [],
          nowIso,
          nowMs,
        }),
        changed: true,
      };
    }

    // KV 仍為 running 或尚無結束狀態：維持進行中，等待下次 check_due
    return { notification: null, changed };
  }

  // 雙源交叉校準分支：已取得對應本次任務的 GitHub Actions Run
  const runId = String(matchedRun.id ?? track.runId ?? '');
  const runStatus = asTrimmedString(matchedRun.status).toLowerCase() || 'unknown';
  const runConclusion = asTrimmedString(matchedRun.conclusion).toLowerCase() || '';
  const runHtmlUrl = asTrimmedString(matchedRun.html_url) || track.actionsUrl;
  const runNumberLabel =
    typeof matchedRun.run_number === 'number'
      ? `#${matchedRun.run_number}`
      : runId
        ? `#${runId}`
        : '';
  const displayTitle =
    asTrimmedString(matchedRun.display_title) || asTrimmedString(matchedRun.name) || '自我升級任務';

  if (runId) track.runId = runId;
  if (runHtmlUrl) track.actionsUrl = runHtmlUrl;

  const isActionsCompleted = runStatus === 'completed';
  const isActionsFailedOrCancelled =
    isActionsCompleted && (ACTIONS_FAILURE_CONCLUSIONS.has(runConclusion) || runConclusion !== 'success');
  const isActionsSuccess = isActionsCompleted && runConclusion === 'success';

  // 若 Actions 尚未 completed，且 KV 也未出現失敗/拒絕/取消或明確 merged，則維持進行中
  if (!isActionsCompleted && !combinedKvFailed && !kvAnalysis.isMergedSuccess) {
    track.lastKnownStatus = runStatus || 'in_progress';
    track.lastKnownConclusion = runConclusion || null;
    return { notification: null, changed: true };
  }

  const extracted =
    isActionsSuccess && !combinedKvFailed
      ? { failedSteps: [], annotationsSummary: [], errorReasons: [], isRejected: false }
      : extractUpgradeFailureDetails(ghRes?.jobs);

  const isRejected = combinedKvRejected || (isActionsFailedOrCancelled && extracted.isRejected);
  const isSuccess =
    !combinedKvFailed &&
    !isRejected &&
    !isActionsFailedOrCancelled &&
    (isActionsSuccess || kvAnalysis.isMergedSuccess);

  let verdict: string;
  if (isSuccess) {
    verdict = 'success';
  } else if (isRejected) {
    verdict = 'rejected';
  } else if (
    runConclusion === 'cancelled' ||
    runConclusion === 'canceled' ||
    combinedKvCancelled
  ) {
    verdict = 'cancelled';
  } else if (runConclusion === 'timed_out' || combinedKvTimedOut) {
    verdict = 'timed_out';
  } else if (runConclusion === 'action_required') {
    verdict = 'action_required';
  } else {
    verdict = runConclusion || 'failure';
  }

  const keyBase = runId || track.startedAt || 'latest';
  const reportKey = `${keyBase}:${verdict}`;
  if (track.reportedRunKeys.includes(reportKey) || (runId && hasRunKeyBeenReported(track.reportedRunKeys, runId))) {
    track.tracking = false;
    track.reported = true;
    return { notification: null, changed: true };
  }

  const mergedErrorReasons: string[] = [];
  for (const r of [...combinedKvReasons, ...extracted.errorReasons]) {
    const trimmed = r.trim();
    if (trimmed && !isIgnorableLogAccessWarning(trimmed) && !mergedErrorReasons.includes(trimmed)) {
      mergedErrorReasons.push(trimmed);
    }
  }

  const summaryLabel = track.summary || kvLatest?.summary || kvLatest?.request || displayTitle;

  track.tracking = false;
  track.reported = true;
  track.lastKnownStatus = isSuccess ? 'completed' : verdict;
  track.lastKnownConclusion = runConclusion || verdict;
  track.reportedAt = nowIso;
  track.reportedRunKeys.push(reportKey);

  const notification = buildUpgradeNotificationItem({
    verdict,
    isSuccess,
    isRejected,
    runId,
    runNumberLabel,
    runStatus,
    runConclusion: runConclusion || verdict,
    actionsUrl: runHtmlUrl,
    prUrl: track.prUrl,
    summaryLabel,
    failedSteps: extracted.failedSteps,
    annotationsSummary: extracted.annotationsSummary,
    errorReasons: mergedErrorReasons,
    nowIso,
    nowMs,
  });

  return { notification, changed: true };
}

export const proactiveMessagesPlugin: PluginTool = {
  declaration: {
    name: 'manage_proactive_messages',
    description:
      '管理桌寵的主動訊息、定時提醒、閒置關懷排程，以及自我升級（KV latest_upgrade 與 GitHub Actions self-upgrade-runner.yml 雙源交叉校準）的完成/失敗/取消主動回報追蹤。支援新增排程(add)、列出所有排程與升級追蹤狀態(list)、啟用或停用排程/總開關(toggle)、切換 AI 隨機生成(toggle_ai)、刪除排程(delete)、登記追蹤自我升級任務(track_upgrade，會自動從 latest_upgrade.actions_url 解析並綁定具體 run_id 與 started_at)、以及檢查到期主動訊息與升級結果(check_due，雙源交叉校準 KV latest_upgrade 與 GitHub Actions Run/Job API，遇到 403/rate limit 自動降級容錯，並以 reportedRunKeys 防止重複通知)。',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: '操作類型：add | list | toggle | toggle_ai | delete | track_upgrade | check_due',
        },
        rule_id: {
          type: 'STRING',
          description: '指定操作的排程 ID 或標題（用於 toggle、toggle_ai 或 delete；若 toggle 時不填或填 global 則切換整體主動訊息總開關）。',
        },
        title: {
          type: 'STRING',
          description: '排程標題／主題（用於 add，例如「早安問候」、「喝水提醒」）。',
        },
        message: {
          type: 'STRING',
          description: '主動訊息內容，或開啟 AI 隨機生成時的參考提示／備用內容（用於 add）。',
        },
        schedule_type: {
          type: 'STRING',
          description: '排程類型：daily（每日固定時間）、interval（固定間隔分鐘數）、idle（閒置超過指定分鐘數觸發）。',
        },
        time: {
          type: 'STRING',
          description: '每日觸發時間，格式為 24 小時制 HH:mm（例如 09:00、22:30，用於 schedule_type 為 daily 時）。',
        },
        interval_minutes: {
          type: 'STRING',
          description: '間隔或閒置分鐘數（正整數，例如 60，用於 schedule_type 為 interval 或 idle 時）。',
        },
        enabled: {
          type: 'STRING',
          description: '是否啟用排程：true 或 false（用於 add 或 toggle）。',
        },
        ai_generated: {
          type: 'STRING',
          description: '是否每次由 AI 根據主題(title)與參考提示(message)隨機生成關懷句子：true 或 false（預設 false，用於 add、toggle 或 toggle_ai）。',
        },
        timezone: {
          type: 'STRING',
          description: '時區設定，預設為 Asia/Taipei。',
        },
        idle_minutes: {
          type: 'STRING',
          description: '選填，用於 check_due 時傳入目前使用者已閒置的分鐘數。',
        },
        mark_triggered: {
          type: 'STRING',
          description: '選填，用於 check_due 時是否自動將到期規則標記為已觸發（預設為 true）。',
        },
        actions_url: {
          type: 'STRING',
          description: '自我升級 GitHub Actions 連結（用於 track_upgrade 或 check_due，例如 https://github.com/owner/repo/actions/runs/12345）。',
        },
        repo: {
          type: 'STRING',
          description: 'GitHub 倉庫 owner/repo（用於 track_upgrade 或 check_due，預設為 ZeroAker/gemini-pet-bff）。',
        },
        workflow_file: {
          type: 'STRING',
          description: 'GitHub Actions workflow 檔名，預設為 self-upgrade-runner.yml。',
        },
        run_id: {
          type: 'STRING',
          description: '欲追蹤或檢查的 GitHub Actions Run ID。',
        },
        pr_url: {
          type: 'STRING',
          description: '選填，自我升級對應的 PR 連結。',
        },
        upgrade_summary: {
          type: 'STRING',
          description: '選填，本次自我升級的功能摘要說明（成功回報時會顯示）。',
        },
        upgrade_status: {
          type: 'STRING',
          description: '選填，已知的自我升級狀態（如 running、merged、rejected、failed、cancelled、timed_out）。',
        },
        upgrade_step: {
          type: 'STRING',
          description: '選填，KV latest_upgrade.step 階段（如 initializing、merged、rejected、failed）。',
        },
        upgrade_logs: {
          type: 'STRING',
          description: '選填，KV latest_upgrade.logs 日誌內容（JSON 字串或換行分隔文字）。',
        },
        upgrade_error: {
          type: 'STRING',
          description: '選填，已知的自我升級錯誤或拒絕原因說明。',
        },
        started_at: {
          type: 'STRING',
          description: '選填，自我升級任務啟動時間（ISO 格式字串）。',
        },
        latest_upgrade: {
          type: 'STRING',
          description: '選填，從 check_upgrade_status 取得的 latest_upgrade JSON 字串或物件，用於雙源交叉校準。',
        },
        github_token: {
          type: 'STRING',
          description: '選填，查詢私有倉庫或 Actions 原始錯誤 log 時使用的 GitHub Token。',
        },
      },
      required: ['action'],
    },
  },
  async execute(args: Record<string, unknown>, ctx: { userId: string }): Promise<Record<string, unknown>> {
    const userId = asTrimmedString(ctx?.userId) || 'default_user';
    const action = asTrimmedString(args.action).toLowerCase();

    if (
      !action ||
      !['add', 'list', 'toggle', 'toggle_ai', 'delete', 'track_upgrade', 'check_due'].includes(action)
    ) {
      return {
        ok: false,
        error: '無效的 action 參數，請使用 add、list、toggle、toggle_ai、delete、track_upgrade 或 check_due。',
      };
    }

    const store = await loadUserStore(userId, ctx);
    const tzArg = asTrimmedString(args.timezone);
    if (tzArg) {
      store.timezone = tzArg;
    }

    if (action === 'list') {
      const kvLatest = await loadKvLatestUpgrade(userId, args, ctx);
      if (kvLatest) {
        const syncRes = syncTrackingFromKvAndArgs(store, kvLatest, args, ctx, new Date().toISOString(), false);
        if (syncRes.changed) {
          await saveUserStore(store, ctx);
        }
      }
      return {
        ok: true,
        action: 'list',
        userId: store.userId,
        globalEnabled: store.globalEnabled,
        timezone: store.timezone,
        lastInteractionAt: store.lastInteractionAt,
        total: store.rules.length,
        rules: store.rules,
        upgradeTracking: store.upgradeTracking,
      };
    }

    if (action === 'track_upgrade') {
      const nowIso = new Date().toISOString();
      const kvLatest = await loadKvLatestUpgrade(userId, args, ctx);
      const regResult = syncTrackingFromKvAndArgs(store, kvLatest, args, ctx, nowIso, true);
      store.lastInteractionAt = nowIso;
      await saveUserStore(store, ctx);
      return {
        ok: true,
        action: 'track_upgrade',
        registered: regResult.registered,
        alreadyReported: regResult.alreadyReported,
        upgradeTracking: store.upgradeTracking,
      };
    }

    if (action === 'add') {
      const rawTime = asTrimmedString(args.time);
      const rawInterval = args.interval_minutes ?? args.intervalMinutes;
      const rawScheduleType = asTrimmedString(args.schedule_type ?? args.scheduleType);
      const scheduleType = normalizeScheduleType(
        rawScheduleType,
        rawTime.length > 0,
        rawInterval !== undefined && rawInterval !== ''
      );

      const defaultTitleMap: Record<ScheduleType, string> = {
        daily: '每日定時問候',
        interval: '週期定時提醒',
        idle: '閒置關懷提醒',
      };
      const defaultMsgMap: Record<ScheduleType, string> = {
        daily: '嗨主人！到了我們約定的時間囉，今天一切都順利嗎？✨',
        interval: '主人～已經過了一段時間囉，記得喝口水、放鬆一下眼睛喔！💧',
        idle: '主人好久不見～忙完的話隨時來跟我聊聊天喔！🐾',
      };

      const rawTitle = asTrimmedString(args.title);
      const rawMessage = asTrimmedString(args.message);
      const title = rawTitle || (rawMessage ? rawMessage.slice(0, 20) : defaultTitleMap[scheduleType]);
      const message = rawMessage || rawTitle || defaultMsgMap[scheduleType];
      const time = normalizeTime(rawTime, scheduleType === 'daily' ? '09:00' : '00:00');
      const intervalMinutes = asPositiveInt(rawInterval, scheduleType === 'idle' ? 120 : 60);
      const enabled = asBoolean(args.enabled, true);
      const aiGenerated = asBoolean(args.ai_generated ?? args.aiGenerated, false);
      const nowIso = new Date().toISOString();
      const customId = asTrimmedString(args.rule_id ?? args.id);
      const id = customId || `rule-${crypto.randomUUID().slice(0, 8)}`;

      const newRule: ProactiveRule = {
        id,
        title,
        message,
        scheduleType,
        time,
        intervalMinutes,
        enabled,
        aiGenerated,
        createdAt: nowIso,
        lastTriggeredAt: null,
      };

      const existingIdx = store.rules.findIndex((r) => r.id === id);
      if (existingIdx >= 0) {
        store.rules[existingIdx] = newRule;
      } else {
        store.rules.push(newRule);
      }
      store.lastInteractionAt = nowIso;
      await saveUserStore(store, ctx);

      return {
        ok: true,
        action: 'add',
        globalEnabled: store.globalEnabled,
        timezone: store.timezone,
        rule: newRule,
        total: store.rules.length,
        rules: store.rules,
      };
    }

    if (action === 'toggle_ai') {
      const ruleId = asTrimmedString(args.rule_id ?? args.ruleId ?? args.id);
      if (!ruleId) {
        return {
          ok: false,
          action: 'toggle_ai',
          error: '請提供欲切換 AI 隨機生成設定的 rule_id。',
          rules: store.rules,
        };
      }

      const targetRule = store.rules.find((r) => r.id === ruleId || r.title === ruleId);
      if (!targetRule) {
        return {
          ok: false,
          action: 'toggle_ai',
          error: `找不到 ID 或標題為「${ruleId}」的排程。`,
          globalEnabled: store.globalEnabled,
          rules: store.rules,
        };
      }

      const rawAiVal = args.ai_generated ?? args.aiGenerated ?? args.enabled;
      const hasExplicitAi = rawAiVal !== undefined && rawAiVal !== '';
      targetRule.aiGenerated = hasExplicitAi
        ? asBoolean(rawAiVal, !targetRule.aiGenerated)
        : !targetRule.aiGenerated;
      store.lastInteractionAt = new Date().toISOString();
      await saveUserStore(store, ctx);

      return {
        ok: true,
        action: 'toggle_ai',
        target: 'rule_ai',
        globalEnabled: store.globalEnabled,
        rule: targetRule,
        rules: store.rules,
      };
    }

    if (action === 'toggle') {
      const ruleId = asTrimmedString(args.rule_id ?? args.ruleId ?? args.id);
      const hasExplicitEnabled = args.enabled !== undefined && args.enabled !== '';
      const rawAiVal = args.ai_generated ?? args.aiGenerated;
      const hasExplicitAi = rawAiVal !== undefined && rawAiVal !== '';

      if (!ruleId || ruleId.toLowerCase() === 'global' || ruleId.toLowerCase() === 'all') {
        store.globalEnabled = hasExplicitEnabled
          ? asBoolean(args.enabled, !store.globalEnabled)
          : !store.globalEnabled;
        store.lastInteractionAt = new Date().toISOString();
        await saveUserStore(store, ctx);
        return {
          ok: true,
          action: 'toggle',
          target: 'global',
          globalEnabled: store.globalEnabled,
          rules: store.rules,
        };
      }

      const targetRule = store.rules.find((r) => r.id === ruleId || r.title === ruleId);
      if (!targetRule) {
        return {
          ok: false,
          action: 'toggle',
          error: `找不到 ID 或標題為「${ruleId}」的排程。`,
          globalEnabled: store.globalEnabled,
          rules: store.rules,
        };
      }

      if (hasExplicitAi && !hasExplicitEnabled) {
        targetRule.aiGenerated = asBoolean(rawAiVal, !targetRule.aiGenerated);
      } else {
        targetRule.enabled = hasExplicitEnabled
          ? asBoolean(args.enabled, !targetRule.enabled)
          : !targetRule.enabled;
        if (hasExplicitAi) {
          targetRule.aiGenerated = asBoolean(rawAiVal, targetRule.aiGenerated);
        }
      }

      store.lastInteractionAt = new Date().toISOString();
      await saveUserStore(store, ctx);

      return {
        ok: true,
        action: 'toggle',
        target: 'rule',
        globalEnabled: store.globalEnabled,
        rule: targetRule,
        rules: store.rules,
      };
    }

    if (action === 'delete') {
      const ruleId = asTrimmedString(args.rule_id ?? args.ruleId ?? args.id);
      if (!ruleId) {
        return {
          ok: false,
          action: 'delete',
          error: '請提供欲刪除的 rule_id。',
          rules: store.rules,
        };
      }

      if (ruleId.toLowerCase() === 'all') {
        const deletedCount = store.rules.length;
        store.rules = [];
        store.lastInteractionAt = new Date().toISOString();
        await saveUserStore(store, ctx);
        return {
          ok: true,
          action: 'delete',
          deletedId: 'all',
          deletedCount,
          rules: store.rules,
        };
      }

      const beforeLen = store.rules.length;
      store.rules = store.rules.filter((r) => r.id !== ruleId && r.title !== ruleId);
      if (store.rules.length === beforeLen) {
        return {
          ok: false,
          action: 'delete',
          error: `找不到 ID 或標題為「${ruleId}」的排程。`,
          rules: store.rules,
        };
      }

      store.lastInteractionAt = new Date().toISOString();
      await saveUserStore(store, ctx);
      return {
        ok: true,
        action: 'delete',
        deletedId: ruleId,
        remainingCount: store.rules.length,
        rules: store.rules,
      };
    }

    // action === 'check_due'
    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const zonedNow = getZonedDateTime(now, store.timezone);
    const markTriggered = asBoolean(args.mark_triggered ?? args.markTriggered, true);

    const explicitIdleRaw = args.idle_minutes ?? args.idleMinutes;
    let effectiveIdleMinutes: number;
    if (explicitIdleRaw !== undefined && explicitIdleRaw !== '') {
      effectiveIdleMinutes = Math.max(0, Number(explicitIdleRaw) || 0);
    } else {
      const lastActiveMs = Date.parse(store.lastInteractionAt);
      effectiveIdleMinutes = Number.isFinite(lastActiveMs)
        ? Math.max(0, (nowMs - lastActiveMs) / 60000)
        : 0;
    }

    if (!store.globalEnabled) {
      return {
        ok: true,
        action: 'check_due',
        globalEnabled: false,
        hasDue: false,
        dueCount: 0,
        dueRules: [],
        upgradeTracking: store.upgradeTracking,
        checkedAt: nowIso,
        timezone: store.timezone,
        localDate: zonedNow.dateStr,
        localTime: zonedNow.timeStr,
      };
    }

    let storeMutated = false;
    const kvLatest = await loadKvLatestUpgrade(userId, args, ctx);
    const hasUpgradeParams =
      asTrimmedString(args.actions_url) !== '' ||
      asTrimmedString(args.repo) !== '' ||
      asTrimmedString(args.run_id) !== '' ||
      asTrimmedString(args.upgrade_status ?? args.status) !== '' ||
      args.latest_upgrade !== undefined;

    if (hasUpgradeParams && !store.upgradeTracking.tracking) {
      const reg = syncTrackingFromKvAndArgs(store, kvLatest, args, ctx, nowIso, true);
      if (reg.changed || reg.registered) {
        storeMutated = true;
      }
    }

    const upgradeCheck = await checkTrackedUpgradeProgress(store, kvLatest, args, ctx, nowIso, nowMs);
    if (upgradeCheck.changed) {
      storeMutated = true;
    }

    const matchedRules: ProactiveRule[] = [];

    for (const rule of store.rules) {
      if (!rule.enabled) continue;

      if (rule.scheduleType === 'daily') {
        const targetMinutes = parseTimeToMinutes(rule.time);
        const diffMinutes = zonedNow.minutesOfDay - targetMinutes;
        const withinDailyWindow = diffMinutes >= 0 && diffMinutes <= 180;

        let alreadyTriggeredToday = false;
        if (rule.lastTriggeredAt) {
          const lastDate = new Date(rule.lastTriggeredAt);
          if (!Number.isNaN(lastDate.getTime())) {
            const zonedLast = getZonedDateTime(lastDate, store.timezone);
            if (zonedLast.dateStr === zonedNow.dateStr) {
              alreadyTriggeredToday = true;
            }
          }
        }

        if (withinDailyWindow && !alreadyTriggeredToday) {
          matchedRules.push(rule);
          if (markTriggered) {
            rule.lastTriggeredAt = nowIso;
            storeMutated = true;
          }
        }
      } else if (rule.scheduleType === 'interval') {
        const intervalMs = rule.intervalMinutes * 60 * 1000;
        const refIso = rule.lastTriggeredAt || rule.createdAt;
        const refMs = Date.parse(refIso);
        if (!Number.isFinite(refMs) || nowMs - refMs >= intervalMs) {
          matchedRules.push(rule);
          if (markTriggered) {
            rule.lastTriggeredAt = nowIso;
            storeMutated = true;
          }
        }
      } else if (rule.scheduleType === 'idle') {
        const cooldownMs = rule.intervalMinutes * 60 * 1000;
        const lastTrigMs = rule.lastTriggeredAt ? Date.parse(rule.lastTriggeredAt) : 0;
        const cooldownPassed = !lastTrigMs || !Number.isFinite(lastTrigMs) || nowMs - lastTrigMs >= cooldownMs;

        if (effectiveIdleMinutes >= rule.intervalMinutes && cooldownPassed) {
          matchedRules.push(rule);
          if (markTriggered) {
            rule.lastTriggeredAt = nowIso;
            storeMutated = true;
          }
        }
      }
    }

    if (storeMutated) {
      await saveUserStore(store, ctx);
    }

    const dueRules: DueNotificationItem[] = [];
    if (upgradeCheck.notification) {
      dueRules.push(upgradeCheck.notification);
    }

    for (const rule of matchedRules) {
      if (rule.aiGenerated) {
        const genResult = await generateAiCareSentence(rule, zonedNow, ctx, args);
        dueRules.push({
          ...rule,
          message: genResult.message,
          originalMessage: rule.message,
          aiGeneratedSuccess: genResult.aiGeneratedSuccess,
        });
      } else {
        dueRules.push({
          ...rule,
          originalMessage: rule.message,
          aiGeneratedSuccess: false,
        });
      }
    }

    return {
      ok: true,
      action: 'check_due',
      globalEnabled: store.globalEnabled,
      hasDue: dueRules.length > 0,
      dueCount: dueRules.length,
      dueRules,
      upgradeTracking: store.upgradeTracking,
      effectiveIdleMinutes: Math.round(effectiveIdleMinutes),
      checkedAt: nowIso,
      timezone: store.timezone,
      localDate: zonedNow.dateStr,
      localTime: zonedNow.timeStr,
    };
  },
};
