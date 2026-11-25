import type { PluginTool } from '../types';

interface GitHubWorkflowRun {
  id: number;
  run_number?: number;
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

export const githubActionsUpgradeStatusPlugin: PluginTool = {
  declaration: {
    name: 'fetch_upgrade_actions_status',
    description:
      '透過 GitHub API 讀取 GitHub Actions 中 Self-Upgrade Runner (self-upgrade-runner.yml) 最新或指定任務的執行狀態 (status/conclusion)、各步驟進度、錯誤註解與執行 log。建議先呼叫核心工具 check_upgrade_status 取得 actions_url，再將 actions_url 或 owner/repo 傳入本工具以準確回報升級詳情。',
    parameters: {
      type: 'OBJECT',
      properties: {
        actions_url: {
          type: 'STRING',
          description:
            '從 check_upgrade_status 取得的 actions_url 或 GitHub Actions 任務連結（例如 https://github.com/owner/repo/actions/runs/12345），會自動解析 owner/repo 與 run_id。',
        },
        repo: {
          type: 'STRING',
          description: 'GitHub 倉庫名稱，格式為 owner/repo（若已提供有效的 actions_url 則可省略）。',
        },
        workflow_file: {
          type: 'STRING',
          description: 'GitHub Actions workflow 檔案名稱，預設為 self-upgrade-runner.yml。',
        },
        run_id: {
          type: 'STRING',
          description: '指定查詢的 Workflow Run ID（選填，未填時自動查詢最新一筆任務）。',
        },
        github_token: {
          type: 'STRING',
          description: '選填的 GitHub Token（公開倉庫不填即可讀取任務狀態、步驟與錯誤註解；讀取原始純文字 log 或私有倉庫時可提供）。',
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
        return {
          ok: true,
          repo,
          workflow_file: workflowFile,
          run: {
            id: targetRun.id,
            run_number: targetRun.run_number ?? null,
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
          .filter((s) => s.conclusion === 'failure' || s.conclusion === 'cancelled' || s.conclusion === 'timed_out')
          .map((s) => ({ number: s.number, name: s.name, status: s.status, conclusion: s.conclusion }));
        const runningSteps = steps
          .filter((s) => s.status === 'in_progress')
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

      return {
        ok: true,
        repo,
        workflow_file: workflowFile,
        run: {
          id: targetRun.id,
          run_number: targetRun.run_number ?? null,
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
