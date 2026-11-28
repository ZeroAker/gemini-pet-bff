import type { PluginContext, PluginTool } from '../types';
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
  runAttempt?: number;
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
  runAttempt?: number;
  retrying?: boolean;
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
  isRetrying: boolean;
  hasTransientError: boolean;
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
  /(\brejected\b|reject_upgrade|安全閘門(?:攔截|拒絕)|拒絕修改|拒絕升級|拒絕原因|受保護.*(?:拒絕|不可|禁止)|不在可編輯|不可修改|禁止刪除|PROTECTED_CORE)/i;

const KV_CODE_ERROR_PATTERN =
  /(error\s+TS\d+|tsc\s+--noEmit.*(?:失敗|錯誤|error)|型別檢查(?:失敗|未通過|錯誤)|型別錯誤|語法錯誤|語法驗證(?:失敗|未通過)|SyntaxError|TypeError|沙盒驗證(?:失敗|未通過)|安全掃描(?:失敗|未通過)|編譯失敗|编译失败|run_checks\s*(?:失敗|未通過))/i;

const KV_MERGE_SUCCESS_PATTERN = /(升級已自動合併至\s*main|已自動合併至\s*main|merged\s+to\s+main)/i;

const RETRY_SIGNAL_PATTERN =
  /(?:\bretry(?:ing)?\b|重試|重新嘗試|再次嘗試|attempt\s*[2-9]|第\s*[2-9]\s*次(?:嘗試|執行|重試))/i;

const RETRY_EXHAUSTED_PATTERN =
  /(?:已達重試上限|重試次數已用盡|超過最大重試|max\s*retries\s*(?:exceeded|reached)|all\s*(?:retries|attempts)\s*failed|最終失敗|放棄重試)/i;

const ACTIONS_ACTIVE_STATUSES = new Set([
  'queued',
  'in_progress',
  'waiting',
  'pending',
  'requested',
]);

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
  const rawAttempt = obj.run_attempt ?? obj.runAttempt ?? obj.attempt;
  const runAttempt = rawAttempt !== undefined && rawAttempt !== null && rawAttempt !== ''
    ? asPositiveInt(rawAttempt, 1)
    : undefined;
  const rawRetrying = obj.retrying ?? obj.is_retrying ?? obj.isRetrying;
  const retrying = rawRetrying !== undefined ? asBoolean(rawRetrying, false) : undefined;

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
    ...(runAttempt !== undefined ? { runAttempt } : {}),
    ...(retrying !== undefined ? { retrying } : {}),
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
    if (fromArgsObj.status) base.status = fromArgsObj.status;
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
    if (fromArgsObj.runAttempt !== undefined) base.runAttempt = fromArgsObj.runAttempt;
    if (fromArgsObj.retrying !== undefined) base.retrying = fromArgsObj.retrying;
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
      isRetrying: false,
      hasTransientError: false,
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

  const isTerminalFailStatus =
    statusLower === 'failed' ||
    statusLower === 'error' ||
    statusLower === 'rejected' ||
    statusLower === 'cancelled' ||
    statusLower === 'canceled' ||
    statusLower === 'timed_out';

  // 若重試後最終已合併成功（status/step 為 merged/success 或有合併成功日誌且非失敗最終狀態），
  // 即使先前重試過程曾留下錯誤日誌，亦明確判定為最終成功
  const isMergedSuccess =
    statusLower === 'merged' ||
    statusLower === 'success' ||
    stepLower === 'merged' ||
    stepLower === 'success' ||
    (hasMergedLog && !isTerminalFailStatus);

  if (isMergedSuccess) {
    return {
      hasKv: true,
      statusLower,
      stepLower,
      isRejected: false,
      isCancelled: false,
      isTimedOut: false,
      isFailedOrCancelled: false,
      isMergedSuccess: true,
      isRunning: false,
      isRetrying: false,
      hasTransientError: false,
      verdict: 'success',
      reasons: [],
    };
  }

  let lastRetryIdx = -1;
  let lastExhaustedIdx = -1;
  for (let i = 0; i < cleanLogs.length; i++) {
    const line = cleanLogs[i] ?? '';
    if (RETRY_EXHAUSTED_PATTERN.test(line)) {
      lastExhaustedIdx = i;
    } else if (RETRY_SIGNAL_PATTERN.test(line)) {
      lastRetryIdx = i;
    }
  }
  const hasActiveRetryLog = lastRetryIdx >= 0 && lastRetryIdx > lastExhaustedIdx;

  const isRetrying =
    Boolean(kv.retrying) ||
    statusLower === 'retrying' ||
    statusLower === 'retry' ||
    stepLower === 'retrying' ||
    stepLower === 'retry' ||
    RETRY_SIGNAL_PATTERN.test(stepLower) ||
    (hasActiveRetryLog && !isTerminalFailStatus) ||
    ((kv.runAttempt ?? 1) > 1 && isInProgressStatus(statusLower));

  const isRejected =
    statusLower === 'rejected' ||
    stepLower === 'rejected' ||
    (!isInProgressStatus(statusLower) &&
      !isRetrying &&
      (REJECTION_KEYWORD_PATTERN.test(cleanError) || rejectionLines.length > 0));

  const isCancelled =
    !isRetrying &&
    (statusLower === 'cancelled' ||
      statusLower === 'canceled' ||
      (!isInProgressStatus(statusLower) && (stepLower === 'cancelled' || stepLower === 'canceled')));

  const isTimedOut =
    !isRetrying &&
    (statusLower === 'timed_out' || (!isInProgressStatus(statusLower) && stepLower === 'timed_out'));

  const isFailedStatus =
    !isRetrying &&
    (statusLower === 'failed' ||
      statusLower === 'error' ||
      (!isInProgressStatus(statusLower) && (stepLower === 'failed' || stepLower === 'error')));

  const hasTransientError =
    codeErrorLines.length > 0 ||
    generalFailLines.length > 0 ||
    cleanError.length > 0 ||
    statusLower === 'failed' ||
    statusLower === 'error' ||
    stepLower === 'failed' ||
    stepLower === 'error';

  // 當 KV status 仍為進行中或重試中（且非明確最終拒絕/取消/逾時/失敗）時，
  // 即使日誌中暫時出現單次編譯或測試錯誤，仍視為執行中（等待重試或完成），不可提早判定為最終失敗
  const isRunning =
    !isRejected &&
    !isCancelled &&
    !isTimedOut &&
    !isFailedStatus &&
    (isRetrying || isInProgressStatus(statusLower) || statusLower === '');

  const isFailedOrCancelled =
    !isRunning &&
    (isRejected ||
      isCancelled ||
      isTimedOut ||
      isFailedStatus ||
      codeErrorLines.length > 0 ||
      cleanError.length > 0);

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
  if (
    (isFailedOrCancelled || hasTransientError) &&
    reasons.length === 0 &&
    kv.step &&
    !isInProgressStatus(kv.step) &&
    stepLower !== 'merged'
  ) {
    pushReason(`停在階段：${kv.step}`);
  }

  let verdict: KvUpgradeAnalysis['verdict'] = 'running';
  if (isRejected) verdict = 'rejected';
  else if (isCancelled) verdict = 'cancelled';
  else if (isTimedOut) verdict = 'timed_out';
  else if (isFailedOrCancelled) verdict = 'failure';
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
    isMergedSuccess: false,
    isRunning,
    isRetrying,
    hasTransientError,
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
    runAttempt: 1,
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
    runAttempt: asPositiveInt(obj.runAttempt, 1),
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

function extractStateSvcFromContext(ctx: { userId: string }): {
  getProactiveStore?: <T = unknown>(userId: string) => Promise<T | null>;
  saveProactiveStore?: (userId: string, store: unknown) => Promise<void>;
} | null {
  const raw = ctx as unknown as {
    stateSvc?: {
      getProactiveStore?: <T = unknown>(userId: string) => Promise<T | null>;
      saveProactiveStore?: (userId: string, store: unknown) => Promise<void>;
    };
  };
  if (raw?.stateSvc && typeof raw.stateSvc.getProactiveStore === 'function') {
    return raw.stateSvc;
  }
  return null;
}

async function loadUserStore(userId: string, ctx: { userId: string }): Promise<ProactiveUserStore> {
  const stateSvc = extractStateSvcFromContext(ctx);
  if (stateSvc?.getProactiveStore) {
    try {
      const redisRaw = await stateSvc.getProactiveStore<unknown>(userId);
      if (redisRaw) {
        const parsed = sanitizeStore(redisRaw, userId);
        MEMORY_STORE.set(userId, parsed);
        return parsed;
      }
    } catch {
      // fallback to kv / cache / memory
    }
  }

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

  const stateSvc = extractStateSvcFromContext(ctx);
  if (stateSvc?.saveProactiveStore) {
    try {
      await stateSvc.saveProactiveStore(store.userId, store);
    } catch {
      // ignore redis write failure and continue fallback writes
    }
  }

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
    lower === 'pr_created' ||
    lower === 'retrying' ||
    lower === 'retry'
  );
}

function isActionsRunActive(status: string): boolean {
  const lower = status.trim().toLowerCase();
  if (!lower) return false;
  if (ACTIONS_ACTIVE_STATUSES.has(lower)) return true;
  return (
    lower !== 'completed' &&
    lower !== 'idle' &&
    lower !== 'unknown' &&
    !ACTIONS_FAILURE_CONCLUSIONS.has(lower) &&
    lower !== 'failed' &&
    lower !== 'error' &&
    lower !== 'rejected' &&
    lower !== 'merged' &&
    lower !== 'success'
  );
}

function clearNonSuccessReportedRunKeys(reportedRunKeys: string[], keyPrefix: string): string[] {
  if (!keyPrefix) return reportedRunKeys;
  return reportedRunKeys.filter(
    (k) => k === `${keyPrefix}:success` || (k !== keyPrefix && !k.startsWith(`${keyPrefix}:`))
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

  const rawAttemptArg = args.run_attempt ?? args.runAttempt ?? kvLatest?.runAttempt;
  const candidateRunAttempt =
    rawAttemptArg !== undefined && rawAttemptArg !== null && rawAttemptArg !== ''
      ? asPositiveInt(rawAttemptArg, 1)
      : 0;
  const prevAttempt = track.runAttempt ?? 1;
  const isRunAttemptIncremented = candidateRunAttempt > prevAttempt;

  const kvCheck = analyzeKvLatestUpgrade(kvLatest);
  const rawStatus =
    asTrimmedString(args.upgrade_status ?? args.status) ||
    kvLatest?.status ||
    track.lastKnownStatus ||
    'running';
  const lowerStatus = rawStatus.toLowerCase();
  const isRetryingOrActiveNow =
    isRunAttemptIncremented ||
    kvCheck.isRetrying ||
    isInProgressStatus(lowerStatus);

  if (isRunAttemptIncremented) {
    track.runAttempt = candidateRunAttempt;
    if (candidateRunId) {
      track.reportedRunKeys = clearNonSuccessReportedRunKeys(track.reportedRunKeys, candidateRunId);
    }
    if (resolvedStartedAt) {
      track.reportedRunKeys = clearNonSuccessReportedRunKeys(track.reportedRunKeys, resolvedStartedAt);
    }
    changed = true;
  }

  const isAlreadyReportedForRun =
    candidateRunId !== '' && hasRunKeyBeenReported(track.reportedRunKeys, candidateRunId);
  const isAlreadyReportedForStart =
    candidateRunId === '' &&
    resolvedStartedAt !== null &&
    hasRunKeyBeenReported(track.reportedRunKeys, resolvedStartedAt);

  if (forceRegister && (isAlreadyReportedForRun || isAlreadyReportedForStart) && !isRetryingOrActiveNow) {
    return { registered: false, alreadyReported: true, changed };
  }

  const isNewSpecificRun = candidateRunId !== '' && candidateRunId !== track.runId && !isAlreadyReportedForRun;
  const isNewStartSession =
    candidateRunId === '' &&
    kvLatest?.startedAt != null &&
    kvLatest.startedAt !== track.startedAt &&
    !hasRunKeyBeenReported(track.reportedRunKeys, kvLatest.startedAt);

  if (
    forceRegister ||
    isNewSpecificRun ||
    isNewStartSession ||
    isRunAttemptIncremented ||
    (!track.tracking && kvLatest && (!isAlreadyReportedForRun && !isAlreadyReportedForStart || isRetryingOrActiveNow))
  ) {
    track.tracking = true;
    track.reported = false;
    track.reportedAt = null;
    track.lastKnownConclusion = null;
    if (isNewSpecificRun || isNewStartSession) {
      track.runAttempt = candidateRunAttempt > 0 ? candidateRunAttempt : 1;
      track.lastKnownError = '';
    }
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
  } else if (!cleanExplicitError && (isRetryingOrActiveNow || kvCheck.isMergedSuccess) && track.lastKnownError !== '') {
    track.lastKnownError = '';
    changed = true;
  }

  if (kvCheck.isMergedSuccess || lowerStatus === 'merged' || lowerStatus === 'success') {
    if (track.lastKnownStatus !== 'merged') {
      track.lastKnownStatus = 'merged';
      changed = true;
    }
  } else if (isRetryingOrActiveNow || (track.tracking && !track.reported && isInProgressStatus(rawStatus))) {
    const nextInProgress = isInProgressStatus(rawStatus) ? rawStatus : 'running';
    if (track.lastKnownStatus !== nextInProgress) {
      track.lastKnownStatus = nextInProgress;
      changed = true;
    }
  } else if (
    lowerStatus === 'rejected' ||
    lowerStatus === 'failed' ||
    lowerStatus === 'error' ||
    lowerStatus === 'cancelled' ||
    lowerStatus === 'canceled' ||
    lowerStatus === 'timed_out'
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
    const jobConclusion = asTrimmedString(job.conclusion).toLowerCase();
    // 若該 job 已重試成功 (conclusion === 'success')，略過其中過程性的失敗步驟
    if (jobConclusion === 'success') continue;
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

interface ActionsProgressInspection {
  runStatus: string;
  runConclusion: string;
  runAttempt: number;
  isAttemptUpdated: boolean;
  isRunActive: boolean;
  hasActiveJob: boolean;
  hasActiveStep: boolean;
  hasPriorFailedStepOrJob: boolean;
  isRetryingOrInProgress: boolean;
  isFullyCompleted: boolean;
  isCompletedSuccess: boolean;
  isCompletedFailure: boolean;
}

function inspectActionsProgress(
  matchedRun: Record<string, unknown>,
  jobsRaw: unknown,
  prevRunAttempt: number
): ActionsProgressInspection {
  const runStatus = asTrimmedString(matchedRun.status).toLowerCase() || 'unknown';
  const runConclusion = asTrimmedString(matchedRun.conclusion).toLowerCase() || '';
  const rawRunAttempt = matchedRun.run_attempt ?? matchedRun.runAttempt;
  let maxAttempt =
    rawRunAttempt !== undefined && rawRunAttempt !== null && rawRunAttempt !== ''
      ? asPositiveInt(rawRunAttempt, 1)
      : 1;

  let hasActiveJob = false;
  let hasActiveStep = false;
  let hasPriorFailedStepOrJob = false;

  const jobs = Array.isArray(jobsRaw) ? jobsRaw : [];
  for (const item of jobs) {
    if (!item || typeof item !== 'object') continue;
    const job = item as Record<string, unknown>;
    const jobStatus = asTrimmedString(job.status).toLowerCase();
    const jobConclusion = asTrimmedString(job.conclusion).toLowerCase();
    const rawJobAttempt = job.run_attempt ?? job.runAttempt;
    if (rawJobAttempt !== undefined && rawJobAttempt !== null && rawJobAttempt !== '') {
      const parsedJobAttempt = asPositiveInt(rawJobAttempt, 1);
      if (parsedJobAttempt > maxAttempt) {
        maxAttempt = parsedJobAttempt;
      }
    }

    if (isActionsRunActive(jobStatus)) {
      hasActiveJob = true;
    }
    if (jobConclusion && ACTIONS_FAILURE_CONCLUSIONS.has(jobConclusion)) {
      hasPriorFailedStepOrJob = true;
    }

    const runningSteps = Array.isArray(job.running_steps) ? job.running_steps : [];
    if (runningSteps.length > 0) {
      hasActiveStep = true;
    }

    const failedSteps = Array.isArray(job.failed_steps) ? job.failed_steps : [];
    if (failedSteps.length > 0) {
      hasPriorFailedStepOrJob = true;
    }

    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const stItem of steps) {
      if (!stItem || typeof stItem !== 'object') continue;
      const st = stItem as Record<string, unknown>;
      const stStatus = asTrimmedString(st.status).toLowerCase();
      const stConclusion = asTrimmedString(st.conclusion).toLowerCase();
      if (isActionsRunActive(stStatus)) {
        hasActiveStep = true;
      }
      if (stConclusion && ACTIONS_FAILURE_CONCLUSIONS.has(stConclusion)) {
        hasPriorFailedStepOrJob = true;
      }
    }
  }

  const isRunActive = isActionsRunActive(runStatus);
  const isAttemptUpdated = maxAttempt > Math.max(1, prevRunAttempt);
  const isRetryingOrInProgress = isRunActive || hasActiveJob || hasActiveStep;
  const isFullyCompleted = runStatus === 'completed' && !hasActiveJob && !hasActiveStep;
  const isCompletedSuccess = isFullyCompleted && runConclusion === 'success';
  const isCompletedFailure =
    isFullyCompleted && (ACTIONS_FAILURE_CONCLUSIONS.has(runConclusion) || runConclusion !== 'success');

  return {
    runStatus,
    runConclusion,
    runAttempt: maxAttempt,
    isAttemptUpdated,
    isRunActive,
    hasActiveJob,
    hasActiveStep,
    hasPriorFailedStepOrJob,
    isRetryingOrInProgress,
    isFullyCompleted,
    isCompletedSuccess,
    isCompletedFailure,
  };
}

async function checkTrackedUpgradeProgress(
  store: ProactiveUserStore,
  kvLatest: KvLatestUpgradeSnapshot | null,
  args: Record<string, unknown>,
  ctx: PluginContext,
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
  const explicitStep = asTrimmedString(args.upgrade_step ?? args.step).toLowerCase();
  const explicitErrorRaw = asTrimmedString(args.upgrade_error ?? args.error);
  const cleanExplicitError = isIgnorableLogAccessWarning(explicitErrorRaw) ? '' : explicitErrorRaw;

  const isExplicitMerged =
    explicitStatus === 'merged' ||
    explicitStatus === 'success' ||
    explicitStep === 'merged' ||
    explicitStep === 'success';
  const isExplicitRunningOrRetrying =
    isInProgressStatus(explicitStatus) ||
    isInProgressStatus(explicitStep) ||
    RETRY_SIGNAL_PATTERN.test(explicitStep);

  const isExplicitRejected =
    !isExplicitMerged &&
    !kvAnalysis.isMergedSuccess &&
    (explicitStatus === 'rejected' ||
      explicitStep === 'rejected' ||
      (!isExplicitRunningOrRetrying && REJECTION_KEYWORD_PATTERN.test(cleanExplicitError)));
  const isExplicitCancelled =
    !isExplicitMerged &&
    !kvAnalysis.isMergedSuccess &&
    !isExplicitRunningOrRetrying &&
    (explicitStatus === 'cancelled' ||
      explicitStatus === 'canceled' ||
      explicitStep === 'cancelled' ||
      explicitStep === 'canceled');
  const isExplicitTimedOut =
    !isExplicitMerged &&
    !kvAnalysis.isMergedSuccess &&
    !isExplicitRunningOrRetrying &&
    (explicitStatus === 'timed_out' || explicitStep === 'timed_out');
  const isExplicitFailed =
    !isExplicitMerged &&
    !kvAnalysis.isMergedSuccess &&
    !isExplicitRunningOrRetrying &&
    (isExplicitRejected ||
      isExplicitCancelled ||
      isExplicitTimedOut ||
      explicitStatus === 'failed' ||
      explicitStatus === 'error' ||
      explicitStep === 'failed' ||
      explicitStep === 'error');

  const combinedKvMerged = kvAnalysis.isMergedSuccess || isExplicitMerged;
  const combinedKvRunningOrRetrying =
    !combinedKvMerged && (kvAnalysis.isRunning || kvAnalysis.isRetrying || isExplicitRunningOrRetrying);
  const combinedKvRejected = !combinedKvMerged && (kvAnalysis.isRejected || isExplicitRejected);
  const combinedKvCancelled = !combinedKvMerged && (kvAnalysis.isCancelled || isExplicitCancelled);
  const combinedKvTimedOut = !combinedKvMerged && (kvAnalysis.isTimedOut || isExplicitTimedOut);
  const combinedKvFailed =
    !combinedKvMerged &&
    !combinedKvRunningOrRetrying &&
    (kvAnalysis.isFailedOrCancelled || isExplicitFailed);

  const combinedKvReasons: string[] = [...kvAnalysis.reasons];
  if (cleanExplicitError && !combinedKvReasons.includes(cleanExplicitError)) {
    combinedKvReasons.unshift(cleanExplicitError);
  }
  if (
    combinedKvReasons.length === 0 &&
    track.lastKnownError &&
    !isIgnorableLogAccessWarning(track.lastKnownError)
  ) {
    combinedKvReasons.push(track.lastKnownError);
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
  let hasOngoingActionsRunInRepo = false;
  const ghApiSucceeded = Boolean(ghRes && ghRes.ok === true && ghRes.run && typeof ghRes.run === 'object');

  if (ghApiSucceeded && ghRes) {
    const candidateRun = ghRes.run as Record<string, unknown>;
    const candidateRunId = String(candidateRun.id ?? '');
    const candidateStatus = asTrimmedString(candidateRun.status).toLowerCase();
    const candidateIsActive = isActionsRunActive(candidateStatus);
    const rawCandidateAttempt = candidateRun.run_attempt ?? candidateRun.runAttempt;
    const candidateAttempt =
      rawCandidateAttempt !== undefined && rawCandidateAttempt !== null && rawCandidateAttempt !== ''
        ? asPositiveInt(rawCandidateAttempt, 1)
        : 1;
    const hadBoundRunId = track.runId !== '';

    if (candidateIsActive) {
      hasOngoingActionsRunInRepo = true;
    } else if (Array.isArray(ghRes.recent_runs)) {
      for (const rItem of ghRes.recent_runs) {
        if (rItem && typeof rItem === 'object') {
          const rStatus = asTrimmedString((rItem as Record<string, unknown>).status).toLowerCase();
          if (isActionsRunActive(rStatus)) {
            hasOngoingActionsRunInRepo = true;
            break;
          }
        }
      }
    }

    if (hadBoundRunId && candidateRunId === track.runId) {
      matchedRun = candidateRun;
    } else if (!hadBoundRunId && candidateRunId) {
      const alreadyReportedThisId = hasRunKeyBeenReported(track.reportedRunKeys, candidateRunId);
      const isRetryOfReportedRun =
        alreadyReportedThisId && (candidateIsActive || candidateAttempt > (track.runAttempt ?? 1));

      if (candidateIsActive && (!alreadyReportedThisId || isRetryOfReportedRun)) {
        // 若該 workflow run 正處於 queued / in_progress / waiting / pending，代表正在執行或重試中，直接綁定
        matchedRun = candidateRun;
        track.runId = candidateRunId;
        track.runAttempt = candidateAttempt;
        const htmlUrl = asTrimmedString(candidateRun.html_url);
        if (htmlUrl) track.actionsUrl = htmlUrl;
      } else {
        const refStartStr = kvLatest?.startedAt || track.startedAt || '';
        const refStartMs = refStartStr ? Date.parse(refStartStr) : Number.NaN;
        const runUpdatedStr = asTrimmedString(candidateRun.updated_at) || asTrimmedString(candidateRun.created_at);
        const runCreatedStr = asTrimmedString(candidateRun.created_at) || runUpdatedStr;
        const runUpdatedMs = runUpdatedStr ? Date.parse(runUpdatedStr) : Number.NaN;
        const runCreatedMs = runCreatedStr ? Date.parse(runCreatedStr) : Number.NaN;

        const isStaleHistoricalRun =
          (alreadyReportedThisId && !isRetryOfReportedRun) ||
          (Number.isFinite(refStartMs) &&
            ((Number.isFinite(runUpdatedMs) && runUpdatedMs < refStartMs - 60000) ||
              (Number.isFinite(runCreatedMs) &&
                candidateStatus === 'completed' &&
                runCreatedMs < refStartMs - 60000)));

        if (!isStaleHistoricalRun) {
          matchedRun = candidateRun;
          track.runId = candidateRunId;
          track.runAttempt = candidateAttempt;
          const htmlUrl = asTrimmedString(candidateRun.html_url);
          if (htmlUrl) track.actionsUrl = htmlUrl;
        }
      }
    } else if (candidateRunId) {
      matchedRun = candidateRun;
    }
  }

  // 降級容錯分支：當 GitHub Actions API 查詢失敗 (ok: false 或 HTTP 403 rate limit) 或尚未抓到對應新 run 時
  if (!matchedRun) {
    // 若倉庫中仍有正在執行的 workflow run，或 KV 顯示正在執行/重試中，維持追蹤等待
    if (hasOngoingActionsRunInRepo || combinedKvRunningOrRetrying) {
      return { notification: null, changed };
    }

    if (combinedKvMerged) {
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
      track.lastKnownError = '';
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

    // 僅當確認為不可重試的最終拒絕（rejected）且無進行中任務，或 GitHub API 無法存取（403/降級）且 KV 已明確處於最終結束失敗狀態時，才發送失敗通知
    if (combinedKvRejected || (!ghApiSucceeded && combinedKvFailed)) {
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

    // 尚無結束狀態或仍在等待對應 GitHub Actions run 完成：維持進行中，等待下次 check_due
    return { notification: null, changed };
  }

  // 雙源交叉校準分支：已取得對應本次任務的 GitHub Actions Run
  const runId = String(matchedRun.id ?? track.runId ?? '');
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

  const inspection = inspectActionsProgress(matchedRun, ghRes?.jobs, track.runAttempt ?? 1);
  const { runStatus, runConclusion } = inspection;

  if (inspection.isAttemptUpdated) {
    track.runAttempt = inspection.runAttempt;
    track.lastKnownConclusion = null;
    track.lastKnownError = '';
    if (runId) {
      track.reportedRunKeys = clearNonSuccessReportedRunKeys(track.reportedRunKeys, runId);
    }
  } else if (inspection.runAttempt > (track.runAttempt ?? 1)) {
    track.runAttempt = inspection.runAttempt;
  }

  // 【核心規則 1 & 2】：
  // 若 GitHub Actions workflow run 的狀態仍為 queued、in_progress、waiting 或 pending（代表正在重試或執行中），
  // 或檢查到仍有步驟/job 處於執行中或重試迴圈中，
  // 即使 KV latest_upgrade 暫時出現錯誤日誌或單次失敗紀錄、或曾有 job/step 失敗，
  // 亦不可提早判定為最終失敗，不可觸發失敗通知或寫入 reportedRunKeys，應繼續維持追蹤等待。
  if (inspection.isRetryingOrInProgress) {
    track.tracking = true;
    track.reported = false;
    track.lastKnownStatus = inspection.isRunActive ? runStatus : 'in_progress';
    track.lastKnownConclusion = null;
    if (runId) {
      track.reportedRunKeys = clearNonSuccessReportedRunKeys(track.reportedRunKeys, runId);
    }
    return { notification: null, changed: true };
  }

  // 【核心規則 3】：
  // 僅當 GitHub Actions workflow run 已完全結束（status === 'completed' 且無進行中 job/step）時，才進行最終判定。
  const isActionsSuccess = inspection.isCompletedSuccess;
  const isActionsFailedOrCancelled = inspection.isCompletedFailure;

  const isExplicitOrKvStatusRejected =
    !combinedKvMerged &&
    (kvAnalysis.statusLower === 'rejected' ||
      kvAnalysis.stepLower === 'rejected' ||
      explicitStatus === 'rejected' ||
      explicitStep === 'rejected');

  // 若重試後最終成功（Actions conclusion === 'success' 或 KV 已 merged），只要非不可重試的明確最終 rejected，即正常回報升級成功
  const isConfirmedTerminalRejected =
    isExplicitOrKvStatusRejected ||
    (!combinedKvMerged &&
      !isActionsSuccess &&
      (combinedKvRejected || (isActionsFailedOrCancelled && extractUpgradeFailureDetails(ghRes?.jobs).isRejected)));

  const isSuccess =
    !isConfirmedTerminalRejected &&
    (isActionsSuccess || (combinedKvMerged && !isActionsFailedOrCancelled));

  const extracted = isSuccess
    ? { failedSteps: [], annotationsSummary: [], errorReasons: [], isRejected: false }
    : extractUpgradeFailureDetails(ghRes?.jobs);

  const isRejected = !isSuccess && (isConfirmedTerminalRejected || combinedKvRejected || (isActionsFailedOrCancelled && extracted.isRejected));

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
  if (
    track.reportedRunKeys.includes(reportKey) ||
    (runId && track.reportedRunKeys.includes(`${runId}:success`)) ||
    (runId && !isSuccess && hasRunKeyBeenReported(track.reportedRunKeys, runId))
  ) {
    track.tracking = false;
    track.reported = true;
    return { notification: null, changed: true };
  }

  const mergedErrorReasons: string[] = [];
  if (!isSuccess) {
    for (const r of [...combinedKvReasons, ...extracted.errorReasons]) {
      const trimmed = r.trim();
      if (trimmed && !isIgnorableLogAccessWarning(trimmed) && !mergedErrorReasons.includes(trimmed)) {
        mergedErrorReasons.push(trimmed);
      }
    }
  }

  const summaryLabel = track.summary || kvLatest?.summary || kvLatest?.request || displayTitle;

  track.tracking = false;
  track.reported = true;
  track.lastKnownStatus = isSuccess ? 'completed' : verdict;
  track.lastKnownConclusion = isSuccess ? 'success' : runConclusion || verdict;
  if (isSuccess) {
    track.lastKnownError = '';
  }
  track.reportedAt = nowIso;
  track.reportedRunKeys.push(reportKey);

  const notification = buildUpgradeNotificationItem({
    verdict,
    isSuccess,
    isRejected,
    runId,
    runNumberLabel,
    runStatus,
    runConclusion: isSuccess ? 'success' : runConclusion || verdict,
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
      '管理主動訊息、定時/閒置提醒排程與自我升級追蹤回報（add/list/toggle/toggle_ai/delete/track_upgrade/check_due）。',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'add | list | toggle | toggle_ai | delete | track_upgrade | check_due',
        },
        rule_id: {
          type: 'STRING',
          description: '排程 ID 或標題（toggle 留空或 global 表總開關）',
        },
        title: {
          type: 'STRING',
          description: '排程標題（add 用）',
        },
        message: {
          type: 'STRING',
          description: '提醒內容或 AI 生成提示（add 用）',
        },
        schedule_type: {
          type: 'STRING',
          description: 'daily | interval | idle',
        },
        time: {
          type: 'STRING',
          description: '每日時間 HH:mm（daily 用）',
        },
        interval_minutes: {
          type: 'STRING',
          description: '間隔或閒置分鐘數（正整數）',
        },
        enabled: {
          type: 'STRING',
          description: 'true | false（啟用狀態）',
        },
        ai_generated: {
          type: 'STRING',
          description: 'true | false（AI 隨機生成）',
        },
        timezone: {
          type: 'STRING',
          description: '時區，預設 Asia/Taipei',
        },
        idle_minutes: {
          type: 'STRING',
          description: '目前閒置分鐘數（check_due 選填）',
        },
        mark_triggered: {
          type: 'STRING',
          description: 'true | false（check_due 標記已觸發，預設 true）',
        },
        actions_url: {
          type: 'STRING',
          description: '升級 Actions 連結',
        },
        repo: {
          type: 'STRING',
          description: '倉庫 owner/repo',
        },
        workflow_file: {
          type: 'STRING',
          description: 'workflow 檔名，預設 self-upgrade-runner.yml',
        },
        run_id: {
          type: 'STRING',
          description: 'Actions Run ID',
        },
        run_attempt: {
          type: 'STRING',
          description: '重試次數（正整數，選填）',
        },
        pr_url: {
          type: 'STRING',
          description: '升級 PR 連結（選填）',
        },
        upgrade_summary: {
          type: 'STRING',
          description: '升級摘要（選填）',
        },
        upgrade_status: {
          type: 'STRING',
          description: 'running | merged | rejected | failed | cancelled | timed_out',
        },
        upgrade_step: {
          type: 'STRING',
          description: 'KV 升級階段（選填）',
        },
        upgrade_logs: {
          type: 'STRING',
          description: 'KV 升級日誌（選填）',
        },
        upgrade_error: {
          type: 'STRING',
          description: '升級錯誤或拒絕原因（選填）',
        },
        started_at: {
          type: 'STRING',
          description: '升級啟動時間 ISO 字串（選填）',
        },
        latest_upgrade: {
          type: 'STRING',
          description: 'check_upgrade_status 的 latest_upgrade（選填）',
        },
        github_token: {
          type: 'STRING',
          description: 'GitHub Token（私有庫選填）',
        },
      },
      required: ['action'],
    },
  },
  async execute(args: Record<string, unknown>, ctx: PluginContext): Promise<Record<string, unknown>> {
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

export async function getProactiveScheduleForApi(
  userId: string,
  stateSvc: PluginContext['stateSvc']
): Promise<ProactiveUserStore> {
  return loadUserStore(userId, { userId, stateSvc } as PluginContext);
}

export async function setProactiveScheduleForApi(
  userId: string,
  stateSvc: PluginContext['stateSvc'],
  payload: {
    globalEnabled?: unknown;
    timezone?: unknown;
    rules?: unknown;
  }
): Promise<ProactiveUserStore> {
  const ctx = { userId, stateSvc } as PluginContext;
  const current = await loadUserStore(userId, ctx);
  const nextRaw: Record<string, unknown> = {
    userId,
    globalEnabled: payload.globalEnabled !== undefined ? payload.globalEnabled : current.globalEnabled,
    timezone: asTrimmedString(payload.timezone) || current.timezone || DEFAULT_TIMEZONE,
    lastInteractionAt: current.lastInteractionAt,
    updatedAt: new Date().toISOString(),
    rules: Array.isArray(payload.rules) ? payload.rules : current.rules,
    upgradeTracking: current.upgradeTracking,
  };
  const nextStore = sanitizeStore(nextRaw, userId);
  await saveUserStore(nextStore, ctx);
  return nextStore;
}

export async function claimProactiveRuleTriggerForApi(
  userId: string,
  stateSvc: PluginContext['stateSvc'],
  payload: {
    ruleId: string;
    suppressRuleIds?: string[];
    timezone?: string;
    force?: boolean;
  }
): Promise<{
  claimed: boolean;
  reason?: string;
  store: ProactiveUserStore;
  rule?: ProactiveRule;
}> {
  const ctx = { userId, stateSvc } as PluginContext;
  const store = await loadUserStore(userId, ctx);
  const rule = store.rules.find((r) => r.id === payload.ruleId);
  const force = Boolean(payload.force);

  if (!rule) {
    return { claimed: false, reason: 'rule_not_found', store };
  }
  if (!force && !store.globalEnabled) {
    return { claimed: false, reason: 'global_disabled', store, rule };
  }
  if (!force && !rule.enabled) {
    return { claimed: false, reason: 'rule_disabled', store, rule };
  }

  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const tz = asTrimmedString(payload.timezone) || store.timezone || DEFAULT_TIMEZONE;
  const GLOBAL_PROACTIVE_COOLDOWN_MS = 3 * 60 * 1000;

  if (!force) {
    // 跨裝置全域冷卻檢查：若最近 3 分鐘內已有任何規則觸發過，避免同時段多條排程連環發送
    for (const r of store.rules) {
      if (!r.lastTriggeredAt) continue;
      const prevMs = Date.parse(r.lastTriggeredAt);
      if (!Number.isNaN(prevMs) && nowMs - prevMs >= 0 && nowMs - prevMs < GLOBAL_PROACTIVE_COOLDOWN_MS) {
        return { claimed: false, reason: 'global_proactive_cooldown', store, rule };
      }
    }

    if (rule.scheduleType === 'daily') {
      const todayStr = getZonedDateTime(now, tz).dateStr;
      if (rule.lastTriggeredAt) {
        const parsedLast = new Date(rule.lastTriggeredAt);
        if (!Number.isNaN(parsedLast.getTime())) {
          const lastDateStr = getZonedDateTime(parsedLast, tz).dateStr;
          if (lastDateStr === todayStr) {
            return { claimed: false, reason: 'already_triggered_today', store, rule };
          }
        }
      }
    } else if (rule.scheduleType === 'interval') {
      const intervalMs = (rule.intervalMinutes || 60) * 60000;
      const refMs = Date.parse(rule.lastTriggeredAt || rule.createdAt || nowIso);
      if (!Number.isNaN(refMs) && nowMs - refMs < intervalMs) {
        return { claimed: false, reason: 'interval_cooldown', store, rule };
      }
    } else if (rule.scheduleType === 'idle') {
      const needIdleMs = (rule.intervalMinutes || 120) * 60000;
      const lastTrigMs = rule.lastTriggeredAt ? Date.parse(rule.lastTriggeredAt) : 0;
      if (lastTrigMs && !Number.isNaN(lastTrigMs) && nowMs - lastTrigMs < needIdleMs) {
        return { claimed: false, reason: 'idle_cooldown', store, rule };
      }
    }
  }

  rule.lastTriggeredAt = nowIso;
  if (Array.isArray(payload.suppressRuleIds) && payload.suppressRuleIds.length > 0) {
    const suppressSet = new Set(payload.suppressRuleIds.map((id) => asTrimmedString(id)).filter(Boolean));
    for (const r of store.rules) {
      if (r.id !== rule.id && suppressSet.has(r.id)) {
        r.lastTriggeredAt = nowIso;
      }
    }
  }
  await saveUserStore(store, ctx);
  return { claimed: true, store, rule };
}
