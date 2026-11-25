import type { StateService } from './services';
import type { Env } from './types';

export const PROTECTED_CORE_TOOLS = [
  'get_current_time',
  'manage_todos',
  'fetch_webpage',
  'request_self_upgrade',
  'check_upgrade_status',
] as const;

interface UpgradeOperation {
  action: 'upsert' | 'delete';
  path: string;
  content?: string;
}

interface UpgradePlan {
  rejected?: boolean;
  reject_reason?: string;
  summary: string;
  operations: UpgradeOperation[];
}

export class SelfUpgradeService {
  private githubToken: string;
  private owner: string;
  private repo: string;
  private baseBranch: string;
  private apiKey: string;
  private projectId: string;
  private location: string;
  private candidateModels: string[];

  constructor(env: Env) {
    this.githubToken = (env.GITHUB_TOKEN || '').trim();
    this.owner = (env.GITHUB_OWNER || '').trim();
    this.repo = (env.GITHUB_REPO || '').trim();
    this.baseBranch = (env.GITHUB_BRANCH || 'main').trim();
    this.apiKey = (env.GOOGLE_CLOUD_API_KEY || '').trim();
    this.projectId = (env.GCP_PROJECT_ID || '').trim();
    this.location = (env.GCP_LOCATION || 'global').trim();

    const primary = (env.MODEL_UPGRADER || 'gemini-4-neon').trim();
    this.candidateModels = Array.from(
      new Set(
        [
          primary,
          'gemini-4-argon',
          'gemini-4-hydrogen',
          'gemini-3.8-flash',
          'gemini-3.5-flash-lite',
        ].filter(Boolean)
      )
    );
  }

  private validateOperations(ops: UpgradeOperation[]): void {
    if (!Array.isArray(ops) || ops.length === 0) {
      throw new Error('升級計畫未包含任何有效檔案變更');
    }

    const allowedPluginRegex = /^src\/plugins\/[a-z][a-z0-9-]*\.ts$/;

    for (const op of ops) {
      if (!allowedPluginRegex.test(op.path)) {
        throw new Error(`安全攔截：禁止修改核心或非插件路徑 (${op.path})`);
      }
      if (op.path === 'src/plugins/registry.ts' && op.action === 'delete') {
        throw new Error('安全攔截：禁止刪除插件註冊表 src/plugins/registry.ts');
      }
      if (op.action === 'upsert') {
        if (!op.content || op.content.trim().length < 10) {
          throw new Error(`檔案內容無效：${op.path}`);
        }
        if (/\b(eval|new Function)\b/.test(op.content)) {
          throw new Error(`安全攔截：插件 ${op.path} 包含不允許的動態執行語法`);
        }
      }
    }
  }

  private async githubFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.githubToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GeminiPetUpgrader/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API 失敗 (${res.status}): ${(await res.text()).slice(0, 220)}`);
    }
    return (await res.json()) as T;
  }

  private decodeBase64Utf8(b64: string): string {
    const clean = b64.replace(/\n/g, '');
    const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  private async readCurrentPlugins(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    try {
      const entries = await this.githubFetch<Array<{ name: string; path: string; type: string }>>(
        `/contents/src/plugins?ref=${encodeURIComponent(this.baseBranch)}`
      );
      const tsFiles = entries.filter((e) => e.type === 'file' && e.name.endsWith('.ts'));

      await Promise.all(
        tsFiles.map(async (f) => {
          const fileData = await this.githubFetch<{ content?: string }>(
            `/contents/${f.path}?ref=${encodeURIComponent(this.baseBranch)}`
          );
          if (fileData.content) {
            files[f.path] = this.decodeBase64Utf8(fileData.content);
          }
        })
      );
    } catch {
      files['src/plugins/registry.ts'] =
        "import type { PluginTool } from '../types';\n\nexport const CUSTOM_PLUGINS: PluginTool[] = [];\n";
    }
    return files;
  }

  private buildEndpoint(model: string): string {
    const keyParam = `key=${encodeURIComponent(this.apiKey)}`;
    const host =
      this.location === 'global'
        ? 'https://aiplatform.googleapis.com'
        : `https://${this.location}-aiplatform.googleapis.com`;
    return `${host}/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${model}:generateContent?${keyParam}`;
  }

  private async generateUpgradePlan(
    userInstruction: string,
    currentPlugins: Record<string, string>
  ): Promise<{ plan: UpgradePlan; modelUsed: string }> {
    const existingFilesText = Object.entries(currentPlugins)
      .map(([path, content]) => `--- FILE: ${path} ---\n${content}`)
      .join('\n\n');

    const systemPrompt = [
      '你是這隻 TypeScript Cloudflare Workers AI 桌寵的「自我升級架構師」。',
      '你的任務是根據主人的需求，在 src/plugins/ 目錄內新增、修改或刪除「自訂插件工具」。',
      '',
      '【最高安全與核心保護規則】',
      `1. 絕對不可損害或刪除核心功能（核心工具包含：${PROTECTED_CORE_TOOLS.join(', ')}，以及對話記憶、路由、自我升級本身）。`,
      '2. 如果主人要求刪除或破壞核心功能，你必須回傳 {"rejected": true, "reject_reason": "原因說明", "summary": "", "operations": []}。',
      '3. 你只能操作 src/plugins/*.ts（檔名限小寫英文、數字與連字號），且絕不可刪除 src/plugins/registry.ts。',
      '4. 新增或刪除任何插件檔時，必須同步更新 src/plugins/registry.ts，確保所有 import 與 CUSTOM_PLUGINS 陣列完全一致，絕不能有殘留 import。',
      '5. 新插件工具名稱（declaration.name）只能用 snake_case 英文，且不可與核心工具同名。',
      '6. 執行環境為 Cloudflare Workers（無 Node fs 模組，不可新增第三方 npm 套件），只能使用標準 Web API（fetch, URL, Intl, crypto 等）與純 TypeScript。',
      '7. 程式碼必須完全符合 TypeScript strict mode（無 any、無未使用變數）。',
      '',
      '【PluginTool 型別介面（位於 ../types）】',
      'export interface PluginTool {',
      '  declaration: {',
      '    name: string;',
      '    description: string;',
      '    parameters: {',
      '      type: "OBJECT";',
      '      properties: Record<string, { type: string; description: string }>;',
      '      required?: string[];',
      '    };',
      '  };',
      '  execute: (args: Record<string, unknown>, ctx: { userId: string }) => Promise<Record<string, unknown>>;',
      '}',
      '',
      '【輸出格式】嚴格回傳 JSON：',
      '{"rejected": false, "summary": "繁體中文簡述本次變更", "operations": [{"action": "upsert", "path": "src/plugins/example.ts", "content": "完整檔案程式碼"}, {"action": "delete", "path": "src/plugins/old.ts"}]}',
    ].join('\n');

    const userPrompt = [
      '【目前 src/plugins/ 目錄中的所有現有檔案】',
      existingFilesText,
      '',
      `【主人的升級需求】\n${userInstruction}`,
    ].join('\n');

    const errors: string[] = [];

    for (const model of this.candidateModels) {
      const generationConfig = model.startsWith('gemini-4')
        ? {
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: 'HIGH' },
          }
        : {
            responseMimeType: 'application/json',
            temperature: 0.2,
          };

      const res = await fetch(this.buildEndpoint(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
        };
        const rawText = (data.candidates?.[0]?.content?.parts ?? [])
          .filter((p) => !p.thought && p.text)
          .map((p) => p.text)
          .join('')
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        return { plan: JSON.parse(rawText) as UpgradePlan, modelUsed: model };
      }

      const errText = await res.text();
      errors.push(`[${model} -> ${res.status}] ${errText.slice(0, 160)}`);

      if (res.status !== 403 && res.status !== 404 && res.status !== 429) {
        break;
      }
    }

    throw new Error(`所有升級模型皆無法使用：${errors.join(' | ')}`);
  }

  private async createUpgradePR(plan: UpgradePlan, modelUsed: string): Promise<string> {
    const refData = await this.githubFetch<{ object: { sha: string } }>(
      `/git/ref/heads/${encodeURIComponent(this.baseBranch)}`
    );
    const baseCommitSha = refData.object.sha;

    const commitData = await this.githubFetch<{ tree: { sha: string } }>(
      `/git/commits/${baseCommitSha}`
    );

    const treeItems = plan.operations.map((op) =>
      op.action === 'delete'
        ? { path: op.path, mode: '100644', type: 'blob', sha: null }
        : { path: op.path, mode: '100644', type: 'blob', content: op.content! }
    );

    const newTree = await this.githubFetch<{ sha: string }>('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: commitData.tree.sha,
        tree: treeItems,
      }),
    });

    const newCommit = await this.githubFetch<{ sha: string }>('/git/commits', {
      method: 'POST',
      body: JSON.stringify({
        message: `feat(self-upgrade): ${plan.summary}`,
        tree: newTree.sha,
        parents: [baseCommitSha],
      }),
    });

    const branchName = `self-upgrade/${Date.now()}`;
    await this.githubFetch('/git/refs', {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: newCommit.sha,
      }),
    });

    const pr = await this.githubFetch<{ html_url: string }>('/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title: `🤖 桌寵自我升級：${plan.summary}`,
        head: branchName,
        base: this.baseBranch,
        body: [
          `由 **${modelUsed}** 自動產生並通過安全路徑白名單驗證。`,
          '',
          '### 變更檔案',
          ...plan.operations.map((op) => `- \`${op.action.toUpperCase()}\` \`${op.path}\``),
          '',
          'GitHub Actions 正在執行 `tsc --noEmit` 檢查，通過後將自動合併並觸發 Cloudflare 部署。',
        ].join('\n'),
      }),
    });

    return pr.html_url;
  }

  async runUpgradeJob(userId: string, instruction: string, stateSvc: StateService): Promise<void> {
    if (!this.githubToken || !this.owner || !this.repo) {
      await stateSvc.saveUpgradeStatus(userId, {
        status: 'failed',
        request: instruction,
        error: '尚未設定 GITHUB_TOKEN、GITHUB_OWNER 或 GITHUB_REPO',
        updated_at: new Date().toISOString(),
      });
      return;
    }

    await stateSvc.saveUpgradeStatus(userId, {
      status: 'running',
      request: instruction,
      updated_at: new Date().toISOString(),
    });

    try {
      const currentPlugins = await this.readCurrentPlugins();
      const { plan, modelUsed } = await this.generateUpgradePlan(instruction, currentPlugins);

      if (plan.rejected) {
        await stateSvc.saveUpgradeStatus(userId, {
          status: 'rejected',
          request: instruction,
          error: plan.reject_reason || '此操作可能影響核心功能，已拒絕執行',
          updated_at: new Date().toISOString(),
        });
        return;
      }

      this.validateOperations(plan.operations);
      const prUrl = await this.createUpgradePR(plan, modelUsed);

      await stateSvc.saveUpgradeStatus(userId, {
        status: 'pr_created',
        request: instruction,
        summary: `[${modelUsed}] ${plan.summary}`,
        pr_url: prUrl,
        changed_files: plan.operations.map((o) => `${o.action}:${o.path}`),
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      await stateSvc.saveUpgradeStatus(userId, {
        status: 'failed',
        request: instruction,
        error: err instanceof Error ? err.message : String(err),
        updated_at: new Date().toISOString(),
      });
    }
  }
}