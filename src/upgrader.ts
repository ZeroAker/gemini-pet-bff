import type { StateService } from './services';
import type { Env, UpgradeStatus } from './types';

export const PROTECTED_CORE_TOOLS = [
  'get_current_time',
  'manage_todos',
  'fetch_webpage',
  'request_self_upgrade',
  'check_upgrade_status',
] as const;

export class SelfUpgradeService {
  private githubToken: string;
  private owner: string;
  private repo: string;
  private baseBranch: string;
  private projectId: string;
  private location: string;
  private upgraderModel: string;

  constructor(env: Env) {
    this.githubToken = (env.GITHUB_TOKEN || '').trim();
    this.owner = (env.GITHUB_OWNER || '').trim();
    this.repo = (env.GITHUB_REPO || '').trim();
    this.baseBranch = (env.GITHUB_BRANCH || 'main').trim();
    this.projectId = (env.GCP_PROJECT_ID || '').trim();
    this.location = (env.GCP_LOCATION || 'global').trim();
    this.upgraderModel = (env.MODEL_UPGRADER || 'gemini-4-neon').trim();
  }

  private formatTime(): string {
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
  }

  async dispatchUpgradeJob(
    userId: string,
    instruction: string,
    stateSvc: StateService
  ): Promise<Record<string, unknown>> {
    if (!this.githubToken || !this.owner || !this.repo) {
      return { error: '尚未設定 GITHUB_TOKEN、GITHUB_OWNER 或 GITHUB_REPO' };
    }

    const actionsUrl = `https://github.com/${this.owner}/${this.repo}/actions/workflows/self-upgrade-runner.yml`;
    const now = new Date().toISOString();

    const record: UpgradeStatus = {
      status: 'running',
      step: 'dispatching',
      request: instruction,
      actions_url: actionsUrl,
      logs: [`[${this.formatTime()}] 正在派發任務至 GitHub Actions 遠端升級引擎...`],
      started_at: now,
      updated_at: now,
    };
    await stateSvc.saveUpgradeStatus(userId, record);

    const endpoint = `https://api.github.com/repos/${this.owner}/${this.repo}/actions/workflows/self-upgrade-runner.yml/dispatches`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.githubToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GeminiPetUpgrader/2.0',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: this.baseBranch,
        inputs: {
          user_id: userId,
          instruction,
          gcp_project_id: this.projectId,
          gcp_location: this.location,
          model_upgrader: this.upgraderModel,
        },
      }),
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 220);
      record.status = 'failed';
      record.step = 'dispatch_failed';
      record.error = `GitHub Actions 派發失敗 (${res.status})：${errText}`;
      record.logs = [...(record.logs ?? []), `[${this.formatTime()}] ${record.error}`];
      record.updated_at = new Date().toISOString();
      await stateSvc.saveUpgradeStatus(userId, record);
      return { error: record.error };
    }

    record.step = 'dispatched';
    record.logs = [
      ...(record.logs ?? []),
      `[${this.formatTime()}] 已成功交棒給 GitHub Actions，等待遠端主機啟動（約 10 秒）...`,
    ];
    record.updated_at = new Date().toISOString();
    await stateSvc.saveUpgradeStatus(userId, record);

    return {
      status: 'dispatched',
      engine: `GitHub Actions (${this.upgraderModel} + 自動備援鏈)`,
      actions_url: actionsUrl,
      message: '已成功派發至 GitHub Actions 執行深度思考、型別檢查與自動合併上線，可點擊上方「升級進度」即時追蹤。',
    };
  }
}