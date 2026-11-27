import type { PluginTool } from '../types';

interface GitHubWorkflowRun {
  id: number;
  run_number?: number;
  run_attempt?: number;
  name?: string;
  display_title?: string;
  path?: string;
  event?: string;
  head_branch?: string;
  status: string | null;
  conclusion: string | null;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

interface GitHubWorkflowRunsResponse {
  workflow_runs?: GitHubWorkflowRun[];
}

interface GitHubJobStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at?: string | null;
  completed_at?: string | null;
}

interface GitHubJob {
  id: number;
  run_attempt?: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string;
  steps?: GitHubJobStep[];
}

interface GitHubJobsResponse {
  jobs?: GitHubJob[];
}

interface GitHubAnnotation {
  annotation_level?: string;
  title?: string | null;
  message?: string;
  path?: string;
  start_line?: number;
}

interface ParsedGitHubTarget {
  repo?: string;
  runId?: string;
  workflowFile?: string;
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW_PATTERN = /^[A-Za-z0-9_.-]+$/;
const RUN_ID_PATTERN = /^\d+$/;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseGitHubUrl(rawUrl: string): ParsedGitHubTarget {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
      return {};
    }
    const parts = parsed.pathname.split('/').filter((segment) => segment.length > 0);
    const owner = parts[0];
    const repoName = parts[1];
    if (!owner || !repoName) {
      return {};
    }
    const candidateRepo = `${owner}/${repoName}`;
    if (!REPO_PATTERN.test(candidateRepo)) {
      return {};
    }
    const result: ParsedGitHubTarget = { repo: candidateRepo };
    if (parts[2] === 'actions' && parts[3] === 'runs' && parts[4] && RUN_ID_PATTERN.test(parts[4])) {
      result.runId = parts[4];
    } else if (parts[2] === 'actions' && parts[3] === 'workflows' && parts[4] && WORKFLOW_PATTERN.test(parts[4])) {
      result.workflowFile = parts[4];
    }
    return result;
  } catch {
    return {};
  }
}

function buildGitHubHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Gemini-Pet-Self-Upgrade-Monitor/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r\n/g, '\n');
}

function extractLogSummary(rawLog: string, maxTailChars = 3200): { error_lines: string[]; log_tail: string } {
  const clean = stripAnsi(rawLog);
  const lines = clean.split('\n');
  const errorLines: string[] = [];
  for (const line of lines) {
    if (
      line.includes('##[error]') ||
      /error TS\d+/i.test(line) ||
      /\bError:/i.test(line) ||
      /\bFAILED\b/.test(line) ||
      /Process completed with exit code [1-9]/i.test(line)
    ) {
      const trimmed = line.trim();
      if (trimmed && !errorLines.includes(trimmed)) {
        errorLines.push(trimmed);
        if (errorLines.length >= 15) break;
      }
    }
  }

  let logTail = clean;
  if (clean.length > maxTailChars) {
    const sliced = clean.slice(-maxTailChars);
    const firstNewline = sliced.indexOf('\n');
    logTail = '...(earlier logs omitted)...\n' + (firstNewline >= 0 ? sliced.slice(firstNewline + 1) : sliced);
  }

  return {
    error_lines: errorLines,
    log_tail: logTail.trim(),
  };
}

const REJECTION_SIGNAL_PATTERN = /(\brejected\b|reject_upgrade|安全閘門|拒絕修改|拒絕升級|受保護|核心模組|核心功能|白名單|PROTECTED_CORE)/i;
const LOG_ACCESS_NOISE_PATTERN =
  /(無法直接下載原始純文字\s*log|無法下載純文字\s*log|原始\s*log\s*下載通常需要認證|下載原始純文字\s*log\s*逾時|完成後才可下載完整純文字\s*log|actions\/jobs\/\d+\/logs.*403|HTTP\s*403.*原始.*log)/i;

function isLogAccessNoise(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return LOG_ACCESS_NOISE_PATTERN.test(trimmed);
}

function formatApiError(status: number, res: Response, contextLabel: string): string {
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (status === 403 && remaining === '0') {
    return `${contextLabel} 失敗：GitHub API 已達未認證速率上限（HTTP 403），請稍後再試或提供 github_token。`;
  }
  if (status === 404) {
    return `${contextLabel} 失敗：找不到對應倉庫、workflow 或任務（HTTP 404），若為私有倉庫請提供 github_token。`;
  }
  if (status === 401) {
    return `${contextLabel} 失敗：GitHub 認證失敗（HTTP 401），請檢查 github_token。`;
  }
  return `${contextLabel} 失敗（HTTP ${status}）。`;
}

function buildUpgradeVerdictSummary(
  targetRun: GitHubWorkflowRun,
  jobDetails: Array<Record<string, unknown>>
): {
  is_completed: boolean;
  is_success: boolean;
  is_rejected: boolean;
  verdict: string;
  failed_steps: string[];
  annotations_summary: string[];
  failure_reasons: string[];
  status_message: string;
} {
  const runStatus = (targetRun.status || '').toLowerCase();
  const runConclusion = (targetRun.conclusion || '').toLowerCase();
  const hasActiveJobOrStep = jobDetails.some((j) => {
    const jStatus = asTrimmedString(j.status).toLowerCase();
    const rSteps = Array.isArray(j.running_steps) ? j.running_steps : [];
    return (
      jStatus === 'queued' ||
      jStatus === 'in_progress' ||
      jStatus === 'waiting' ||
      jStatus === 'pending' ||
      (jStatus !== '' && jStatus !== 'completed') ||
      rSteps.length > 0
    );
  });
  const isCompleted = runStatus === 'completed' && !hasActiveJobOrStep;
  const isSuccess = isCompleted && runConclusion === 'success';
  const actionsUrl = targetRun.html_url ?? '';

  const failedSteps: string[] = [];
  const annotationsSummary: string[] = [];
  const failureReasons: string[] = [];

  for (const job of jobDetails) {
    if (isSuccess || asTrimmedString(job.conclusion).toLowerCase() === 'success') {
      continue;
    }
    const jobName = asTrimmedString(job.name) || 'Job';
    const fSteps = Array.isArray(job.failed_steps) ? job.failed_steps : [];
    for (const st of fSteps) {
      if (!st || typeof st !== 'object') continue;
      const sRec = st as Record<string, unknown>;
      const label = `${jobName} > ${asTrimmedString(sRec.name) || '步驟'} (${asTrimmedString(sRec.conclusion) || 'failure'})`;
      if (!failedSteps.includes(label)) failedSteps.push(label);
    }

    const anns = Array.isArray(job.annotations) ? job.annotations : [];
    for (const ann of anns) {
      if (!ann || typeof ann !== 'object') continue;
      const aRec = ann as Record<string, unknown>;
      const msg = asTrimmedString(aRec.message);
      if (!msg) continue;
      const level = asTrimmedString(aRec.level);
      const title = asTrimmedString(aRec.title);
      const filePath = asTrimmedString(aRec.path);
      const lineNum = typeof aRec.start_line === 'number' ? `:${aRec.start_line}` : '';
      const loc = filePath ? `${filePath}${lineNum} ` : '';
      const head = level ? `[${level}] ` : '';
      const titlePart = title ? `${title}: ` : '';
      const formatted = `${head}${loc}${titlePart}${msg}`.trim();
      if (!annotationsSummary.includes(formatted)) annotationsSummary.push(formatted);
    }

    const errLines = Array.isArray(job.error_lines) ? job.error_lines : [];
    for (const line of errLines) {
      const trimmed = asTrimmedString(line);
      if (trimmed && !isLogAccessNoise(trimmed) && !failureReasons.includes(trimmed)) {
        failureReasons.push(trimmed);
      }
    }

    if (failureReasons.length === 0) {
      const tail = asTrimmedString(job.log_tail);
      if (tail) {
        const tailLines = tail
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !isLogAccessNoise(l));
        for (const tl of tailLines.slice(-3)) {
          if (!failureReasons.includes(tl)) failureReasons.push(tl);
        }
      }
    }
  }

  if (!isSuccess && failureReasons.length === 0) {
    for (const ann of annotationsSummary) {
      if (!isLogAccessNoise(ann) && !failureReasons.includes(ann)) {
        failureReasons.push(ann);
      }
    }
    if (failureReasons.length === 0) {
      for (const st of failedSteps) {
        if (!failureReasons.includes(st)) {
          failureReasons.push(st);
        }
      }
    }
  }

  const isRejected =
    isCompleted &&
    !isSuccess &&
    (failedSteps.some((s) => REJECTION_SIGNAL_PATTERN.test(s)) ||
      annotationsSummary.some((a) => REJECTION_SIGNAL_PATTERN.test(a)) ||
      failureReasons.some((r) => REJECTION_SIGNAL_PATTERN.test(r)));

  let verdict = runStatus || 'unknown';
  if (isCompleted) {
    if (isSuccess) verdict = 'success';
    else if (isRejected) verdict = 'rejected';
    else if (runConclusion === 'cancelled') verdict = 'cancelled';
    else if (runConclusion === 'timed_out') verdict = 'timed_out';
    else verdict = runConclusion || 'failure';
  }

  const lines: string[] = [];
  if (!isCompleted) {
    lines.push(`🔄 自我升級任務執行中（status: ${runStatus || 'in_progress'}）。`);
  } else if (isSuccess) {
    lines.push('🎉 自我升級成功！GitHub Actions 已完成且結果為 success（status: completed, conclusion: success）。');
  } else {
    if (isRejected) {
      lines.push(`🚫 自我升級請求被安全閘門拒絕（status: ${runStatus}, conclusion: ${runConclusion || 'failure'}）。`);
    } else if (runConclusion === 'cancelled') {
      lines.push(`⚠️ 自我升級任務已取消（status: ${runStatus}, conclusion: cancelled）。`);
    } else if (runConclusion === 'timed_out') {
      lines.push(`⏱️ 自我升級任務執行逾時（status: ${runStatus}, conclusion: timed_out）。`);
    } else {
      lines.push(`❌ 自我升級任務執行失敗（status: ${runStatus}, conclusion: ${runConclusion || 'failure'}）。`);
    }
    if (failedSteps.length > 0) {
      lines.push(`失敗步驟：${failedSteps.slice(0, 6).join('；')}`);
    }
    if (annotationsSummary.length > 0) {
      lines.push(`Annotations 摘要：${annotationsSummary.slice(0, 4).join(' | ')}`);
    }
    if (failureReasons.length > 0) {
      lines.push(`失敗/拒絕原因：${failureReasons.slice(0, 4).join(' | ')}`);
    }
  }
  if (actionsUrl) {
    lines.push(`Actions 連結：${actionsUrl}`);
  }

  return {
    is_completed: isCompleted,
    is_success: isSuccess,
    is_rejected: isRejected,
    verdict,
    failed_steps: failedSteps.slice(0, 8),
    annotations_summary: annotationsSummary.slice(0, 8),
    failure_reasons: failureReasons.slice(0, 6),
    status_message: lines.join('\n'),
  };
}

export const githubActionsUpgradeStatusPlugin: PluginTool = {
  declaration: {
    name: 'fetch_upgrade_actions_status',
    description: '透過 GitHub API 查詢自我升級 Actions 執行狀態、步驟與錯誤 log。',
    parameters: {
      type: 'OBJECT',
      properties: {
        actions_url: {
          type: 'STRING',
          description: 'Actions 任務連結（自動解析 repo 與 run_id）',
        },
        repo: {
          type: 'STRING',
          description: '倉庫 owner/repo（有 actions_url 可省）',
        },
        workflow_file: {
          type: 'STRING',
          description: 'workflow 檔名，預設 self-upgrade-runner.yml',
        },
        run_id: {
          type: 'STRING',
          description: '指定 Run ID（選填，預設最新）',
        },
        github_token: {
          type: 'STRING',
          description: 'GitHub Token（私有庫或讀 log 選填）',
        },
      },
      required: [],
    },
  },
  async execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const rawActionsUrl = asTrimmedString(args.actions_url);
    const parsedFromUrl = rawActionsUrl ? parseGitHubUrl(rawActionsUrl) : {};

    const repoArg = asTrimmedString(args.repo);
    const repo = repoArg || parsedFromUrl.repo || '';
    if (!repo || !REPO_PATTERN.test(repo)) {
      return {
        ok: false,
        error:
          '缺少有效的 GitHub 倉庫識別資訊（owner/repo）。請先呼叫 check_upgrade_status 取得 actions_url 傳入，或明確提供 repo 參數（格式 owner/repo）。',
      };
    }

    const workflowFile = asTrimmedString(args.workflow_file) || parsedFromUrl.workflowFile || 'self-upgrade-runner.yml';
    if (!WORKFLOW_PATTERN.test(workflowFile)) {
      return {
        ok: false,
        error: 'workflow_file 格式不合法，僅允許英數字、點、底線與連字號。',
      };
    }

    const runId = asTrimmedString(args.run_id) || parsedFromUrl.runId || '';
    if (runId && !RUN_ID_PATTERN.test(runId)) {
      return {
        ok: false,
        error: 'run_id 必須為純數字。',
      };
    }

    const githubToken = asTrimmedString(args.github_token);
    const headers = buildGitHubHeaders(githubToken);

    try {
      let targetRun: GitHubWorkflowRun | null = null;
      let recentRuns: Array<Record<string, unknown>> = [];

      if (runId) {
        const runUrl = `https://api.github.com/repos/${repo}/actions/runs/${runId}`;
        const runRes = await fetchWithTimeout(runUrl, headers);
        if (!runRes.ok) {
          return { ok: false, repo, error: formatApiError(runRes.status, runRes, '讀取指定 Workflow Run') };
        }
        targetRun = (await runRes.json()) as GitHubWorkflowRun;
      } else {
        const workflowRunsUrl = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=3`;
        let runsRes = await fetchWithTimeout(workflowRunsUrl, headers);

        if (runsRes.status === 404) {
          const fallbackUrl = `https://api.github.com/repos/${repo}/actions/runs?per_page=5`;
          runsRes = await fetchWithTimeout(fallbackUrl, headers);
          if (!runsRes.ok) {
            return { ok: false, repo, error: formatApiError(runsRes.status, runsRes, '讀取 Workflow 執行列表') };
          }
          const fallbackData = (await runsRes.json()) as GitHubWorkflowRunsResponse;
          const allRuns = Array.isArray(fallbackData.workflow_runs) ? fallbackData.workflow_runs : [];
          const matched = allRuns.filter((r) => typeof r.path === 'string' && r.path.endsWith(`/${workflowFile}`));
          const listToUse = matched.length > 0 ? matched : allRuns;
          targetRun = listToUse[0] ?? null;
          recentRuns = listToUse.slice(0, 3).map((r) => ({
            id: r.id,
            run_number: r.run_number ?? null,
            name: r.name ?? '',
            status: r.status,
            conclusion: r.conclusion,
            created_at: r.created_at ?? '',
            html_url: r.html_url ?? '',
          }));
        } else if (!runsRes.ok) {
          return { ok: false, repo, error: formatApiError(runsRes.status, runsRes, `讀取 ${workflowFile} 執行列表`) };
        } else {
          const runsData = (await runsRes.json()) as GitHubWorkflowRunsResponse;
          const runs = Array.isArray(runsData.workflow_runs) ? runsData.workflow_runs : [];
          targetRun = runs[0] ?? null;
          recentRuns = runs.slice(0, 3).map((r) => ({
            id: r.id,
            run_number: r.run_number ?? null,
            name: r.name ?? '',
            status: r.status,
            conclusion: r.conclusion,
            created_at: r.created_at ?? '',
            html_url: r.html_url ?? '',
          }));
        }
      }

      if (!targetRun) {
        return {
          ok: true,
          repo,
          workflow_file: workflowFile,
          message: `在 ${repo} 中尚未找到 ${workflowFile} 的執行紀錄。`,
          run: null,
          jobs: [],
        };
      }

      const jobsUrl = `https://api.github.com/repos/${repo}/actions/runs/${targetRun.id}/jobs?per_page=20`;
      const jobsRes = await fetchWithTimeout(jobsUrl, headers);
      if (!jobsRes.ok) {
        const fallbackVerdict = buildUpgradeVerdictSummary(targetRun, []);
        return {
          ok: true,
          repo,
          workflow_file: workflowFile,
          actions_url: targetRun.html_url ?? '',
          ...fallbackVerdict,
          run: {
            id: targetRun.id,
            run_number: targetRun.run_number ?? null,
            run_attempt: targetRun.run_attempt ?? 1,
            name: targetRun.name ?? '',
            display_title: targetRun.display_title ?? '',
            status: targetRun.status,
            conclusion: targetRun.conclusion,
            created_at: targetRun.created_at ?? '',
            updated_at: targetRun.updated_at ?? '',
            html_url: targetRun.html_url ?? '',
          },
          jobs: [],
          warning: formatApiError(jobsRes.status, jobsRes, '讀取任務步驟明細'),
        };
      }

      const jobsData = (await jobsRes.json()) as GitHubJobsResponse;
      const rawJobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
      const jobDetails: Array<Record<string, unknown>> = [];

      for (const job of rawJobs.slice(0, 5)) {
        const steps = Array.isArray(job.steps) ? job.steps : [];
        const failedSteps = steps
          .filter(
            (s) =>
              s.conclusion === 'failure' ||
              s.conclusion === 'cancelled' ||
              s.conclusion === 'timed_out' ||
              s.conclusion === 'action_required'
          )
          .map((s) => ({ number: s.number, name: s.name, status: s.status, conclusion: s.conclusion }));
        const runningSteps = steps
          .filter((s) => {
            const st = (s.status || '').toLowerCase();
            return st === 'in_progress' || st === 'queued' || st === 'waiting' || st === 'pending';
          })
          .map((s) => ({ number: s.number, name: s.name, status: s.status }));

        let annotations: Array<Record<string, unknown>> = [];
        try {
          const annUrl = `https://api.github.com/repos/${repo}/check-runs/${job.id}/annotations?per_page=20`;
          const annRes = await fetchWithTimeout(annUrl, headers, 6000);
          if (annRes.ok) {
            const annData = (await annRes.json()) as unknown;
            if (Array.isArray(annData)) {
              annotations = (annData as GitHubAnnotation[]).map((a) => ({
                level: a.annotation_level ?? '',
                title: a.title ?? '',
                message: a.message ?? '',
                path: a.path ?? '',
                start_line: a.start_line ?? null,
              }));
            }
          }
        } catch {
          // 忽略單一 annotations 查詢逾時，保留主要任務狀態
        }

        let logTail = '';
        let errorLines: string[] = [];
        let logAccessNote = '';

        if (job.status === 'completed') {
          try {
            const logsUrl = `https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`;
            const logsRes = await fetchWithTimeout(logsUrl, headers, 8000);
            if (logsRes.ok) {
              const rawLogText = await logsRes.text();
              const summary = extractLogSummary(rawLogText);
              logTail = summary.log_tail;
              errorLines = summary.error_lines;
            } else {
              logAccessNote = `無法直接下載原始純文字 log（HTTP ${logsRes.status}，GitHub 原始 log 下載通常需要認證 Token）；可參考上方步驟結果、annotations 與 html_url。`;
            }
          } catch {
            logAccessNote = '下載原始純文字 log 逾時或失敗；已保留步驟狀態與錯誤註解。';
          }
        } else {
          logAccessNote = '任務仍在執行中，完成後才可下載完整純文字 log。';
        }

        jobDetails.push({
          id: job.id,
          run_attempt: job.run_attempt ?? 1,
          name: job.name,
          status: job.status,
          conclusion: job.conclusion,
          started_at: job.started_at ?? null,
          completed_at: job.completed_at ?? null,
          html_url: job.html_url ?? '',
          failed_steps: failedSteps,
          running_steps: runningSteps,
          steps: steps.map((s) => ({
            number: s.number,
            name: s.name,
            status: s.status,
            conclusion: s.conclusion,
          })),
          annotations,
          error_lines: errorLines,
          log_tail: logTail,
          log_access_note: logAccessNote,
        });
      }

      const verdictSummary = buildUpgradeVerdictSummary(targetRun, jobDetails);
      return {
        ok: true,
        repo,
        workflow_file: workflowFile,
        actions_url: targetRun.html_url ?? '',
        ...verdictSummary,
        run: {
          id: targetRun.id,
          run_number: targetRun.run_number ?? null,
          run_attempt: targetRun.run_attempt ?? 1,
          name: targetRun.name ?? '',
          display_title: targetRun.display_title ?? '',
          event: targetRun.event ?? '',
          head_branch: targetRun.head_branch ?? '',
          status: targetRun.status,
          conclusion: targetRun.conclusion,
          created_at: targetRun.created_at ?? '',
          updated_at: targetRun.updated_at ?? '',
          html_url: targetRun.html_url ?? '',
        },
        jobs: jobDetails,
        recent_runs: recentRuns,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知錯誤';
      return {
        ok: false,
        repo,
        workflow_file: workflowFile,
        error: `呼叫 GitHub API 時發生例外：${message}`,
      };
    }
  },
};
