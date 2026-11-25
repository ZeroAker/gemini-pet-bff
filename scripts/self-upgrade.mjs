import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROTECTED_CORE_TOOLS = [
  'get_current_time',
  'manage_todos',
  'fetch_webpage',
  'request_self_upgrade',
  'check_upgrade_status',
];

const userId = (process.env.INPUT_USER_ID || 'zero_main').trim();
const instruction = (process.env.INPUT_INSTRUCTION || '').trim();
const apiKey = (process.env.GOOGLE_CLOUD_API_KEY || '').trim();
const projectId = (process.env.INPUT_GCP_PROJECT_ID || '').trim();
const location = (process.env.INPUT_GCP_LOCATION || 'global').trim();
const primaryModel = (process.env.INPUT_MODEL_UPGRADER || 'gemini-4-neon').trim();
const baseBranch = (process.env.BASE_BRANCH || 'main').trim();
const redisUrl = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
const redisToken = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const repoFull = (process.env.GITHUB_REPOSITORY || '').trim();
const runId = (process.env.GITHUB_RUN_ID || '').trim();
const actionsUrl = repoFull && runId ? `https://github.com/${repoFull}/actions/runs/${runId}` : '';

const candidateModels = Array.from(
  new Set(
    [
      primaryModel,
      'gemini-4-argon',
      'gemini-4-hydrogen',
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
    ].filter(Boolean)
  )
);

function formatTime() {
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

async function redisCmd(args) {
  if (!redisUrl || !redisToken) return null;
  const res = await fetch(redisUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result;
}

const record = {
  status: 'running',
  step: 'actions_started',
  request: instruction,
  actions_url: actionsUrl,
  logs: [],
  started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

async function initRecordFromRedis() {
  try {
    const raw = await redisCmd(['GET', `upgrade:${userId}`]);
    if (raw) {
      const prev = JSON.parse(raw);
      if (Array.isArray(prev.logs)) record.logs = prev.logs;
      if (prev.started_at) record.started_at = prev.started_at;
    }
  } catch {
    // 忽略讀取異常，使用新紀錄
  }
}

async function logStep(step, message) {
  const line = `[${formatTime()}] ${message}`;
  console.log(`(${step}) ${line}`);
  record.step = step;
  record.logs = [...record.logs, line].slice(-20);
  record.updated_at = new Date().toISOString();
  await redisCmd(['SET', `upgrade:${userId}`, JSON.stringify(record)]);
}

function readLocalPlugins() {
  const dir = path.resolve('src/plugins');
  fs.mkdirSync(dir, { recursive: true });
  const files = {};
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.ts')) {
      files[`src/plugins/${name}`] = fs.readFileSync(path.join(dir, name), 'utf8');
    }
  }
  if (!files['src/plugins/registry.ts']) {
    files['src/plugins/registry.ts'] =
      "import type { PluginTool } from '../types';\n\nexport const CUSTOM_PLUGINS: PluginTool[] = [];\n";
  }
  return files;
}

function validateOperations(ops) {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('升級計畫未包含任何有效檔案變更');
  }
  const allowedPluginRegex = /^src\/plugins\/[a-z][a-z0-9-]*\.ts$/;
  const coreNameRegex = new RegExp(`name\\s*:\\s*['"](${PROTECTED_CORE_TOOLS.join('|')})['"]`);

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
      if (op.path !== 'src/plugins/registry.ts' && coreNameRegex.test(op.content)) {
        throw new Error(`安全攔截：插件 ${op.path} 不可使用核心保留工具名稱`);
      }
    }
  }
}

function buildEndpoint(model) {
  const host =
    location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

async function generatePlan(currentPlugins) {
  const existingFilesText = Object.entries(currentPlugins)
    .map(([filePath, content]) => `--- FILE: ${filePath} ---\n${content}`)
    .join('\n\n');

  const systemPrompt = [
    '你是這隻 TypeScript Cloudflare Workers AI 桌寵的「自我升級架構師」。',
    '你的任務是根據主人的需求，在 src/plugins/ 目錄內新增、修改或刪除「自訂插件工具」。',
    '',
    '【最高安全與核心保護規則】',
    `1. 絕對不可損害或刪除核心功能（核心工具包含：${PROTECTED_CORE_TOOLS.join(', ')}，以及對話記憶、路由、自我升級本身）。`,
    '2. 如果主人要求刪除或破壞核心功能，必須回傳 {"rejected": true, "reject_reason": "原因說明", "summary": "", "operations": []}。',
    '3. 只能操作 src/plugins/*.ts（檔名限小寫英文、數字與連字號），且絕不可刪除 src/plugins/registry.ts。',
    '4. 新增或刪除任何插件檔時，必須同步更新 src/plugins/registry.ts，確保所有 import 與 CUSTOM_PLUGINS 陣列完全一致。',
    '5. 新插件工具名稱（declaration.name）只能用 snake_case 英文，且不可與核心工具同名。',
    '6. 執行環境為 Cloudflare Workers（不可使用 Node fs 模組或未安裝的第三方套件），僅可使用標準 Web API（fetch, URL, Intl, crypto）與純 TypeScript。',
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
    '【輸出格式】嚴格回傳合法 JSON：',
    '{"rejected": false, "summary": "繁體中文簡述本次變更", "operations": [{"action": "upsert", "path": "src/plugins/example.ts", "content": "完整檔案程式碼"}, {"action": "delete", "path": "src/plugins/old.ts"}]}',
  ].join('\n');

  const userPrompt = [
    '【目前 src/plugins/ 目錄中的所有現有檔案】',
    existingFilesText,
    '',
    `【主人的升級需求】\n${instruction}`,
  ].join('\n');

  const errors = [];

  for (const model of candidateModels) {
    await logStep('generating_code', `GitHub Actions 正在呼叫 ${model} 深度思考並撰寫程式碼...`);

    const generationConfig = model.startsWith('gemini-4')
      ? {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: 'HIGH' },
        }
      : {
          responseMimeType: 'application/json',
          temperature: 0.2,
        };

    try {
      const res = await fetch(buildEndpoint(model), {
        method: 'POST',
        signal: AbortSignal.timeout(180000), // 單模型最多容忍 3 分鐘，不受 Cloudflare 限制
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const rawText = (data.candidates?.[0]?.content?.parts ?? [])
          .filter((p) => !p.thought && p.text)
          .map((p) => p.text)
          .join('')
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        await logStep('code_generated', `${model} 已完成程式碼生成`);
        return { plan: JSON.parse(rawText), modelUsed: model };
      }

      const errText = await res.text();
      errors.push(`[${model} -> ${res.status}] ${errText.slice(0, 150)}`);
      await logStep('model_fallback', `${model} 回傳 ${res.status}，切換下一個備援模型`);

      if (res.status !== 403 && res.status !== 404 && res.status !== 429) {
        break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${model} 異常] ${msg}`);
      await logStep('model_fallback', `${model} 發生異常 (${msg.slice(0, 60)})，切換備援`);
    }
  }

  throw new Error(`所有升級模型皆無法使用：${errors.join(' | ')}`);
}

async function main() {
  await initRecordFromRedis();
  await logStep('actions_started', 'GitHub Actions 遠端環境已就緒，開始讀取現有插件...');

  if (!apiKey || !projectId || !instruction) {
    throw new Error('缺少必要參數（GOOGLE_CLOUD_API_KEY / GCP_PROJECT_ID / instruction）');
  }

  const currentPlugins = readLocalPlugins();
  await logStep('plugins_loaded', `已讀取 ${Object.keys(currentPlugins).length} 個插件檔`);

  const { plan, modelUsed } = await generatePlan(currentPlugins);

  if (plan.rejected) {
    record.status = 'rejected';
    record.error = plan.reject_reason || '此操作可能影響核心功能，已拒絕執行';
    await logStep('rejected', `安全攔截：${record.error}`);
    return;
  }

  await logStep('validating', '正在執行安全白名單與規則檢查...');
  validateOperations(plan.operations);

  // 套用檔案變更到本地工作區
  for (const op of plan.operations) {
    const absPath = path.resolve(op.path);
    if (op.action === 'delete') {
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    } else {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, op.content, 'utf8');
    }
  }

  // 直接執行 TypeScript 嚴格編譯檢查（不通過就不推送，徹底保護線上服務）
  await logStep('type_checking', '正在執行 npx tsc --noEmit 型別安全檢查...');
  try {
    execFileSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`.trim().slice(0, 500);
    throw new Error(`TypeScript 編譯未通過，已中止升級：\n${output}`);
  }
  await logStep('type_check_passed', 'TypeScript 型別檢查全數通過！');

  // 檢查是否有實際檔案差異
  const statusOut = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (!statusOut) {
    throw new Error('程式碼與現有版本完全相同，無需提交變更');
  }

  // 建立升級分支、提交並開啟 PR
  const branchName = `self-upgrade/${Date.now()}`;
  execFileSync('git', ['config', 'user.name', 'Gemini Pet Bot']);
  execFileSync('git', ['config', 'user.email', 'gemini-pet-bot@users.noreply.github.com']);
  execFileSync('git', ['checkout', '-b', branchName]);
  execFileSync('git', ['add', 'src/plugins']);
  execFileSync('git', ['commit', '-m', `feat(self-upgrade): ${plan.summary}`]);

  await logStep('pushing_pr', `正在推送分支 ${branchName} 並建立 Pull Request...`);
  execFileSync('git', ['push', 'origin', branchName]);

  const prBody = [
    `由 **${modelUsed}** 在 GitHub Actions 產生，已通過安全路徑白名單與 \`tsc --noEmit\` 檢查。`,
    '',
    '### 變更檔案',
    ...plan.operations.map((op) => `- \`${op.action.toUpperCase()}\` \`${op.path}\``),
  ].join('\n');

  const prUrl = execFileSync(
    'gh',
    [
      'pr',
      'create',
      '--title',
      `🤖 桌寵自我升級：${plan.summary}`,
      '--body',
      prBody,
      '--base',
      baseBranch,
      '--head',
      branchName,
    ],
    { encoding: 'utf8' }
  ).trim();

  record.pr_url = prUrl;
  record.summary = `[${modelUsed}] ${plan.summary}`;
  record.changed_files = plan.operations.map((o) => `${o.action}:${o.path}`);
  await logStep('merging_pr', 'PR 已建立，正在自動合併至主分支...');

  execFileSync('gh', ['pr', 'merge', prUrl, '--squash', '--delete-branch'], { encoding: 'utf8' });

  record.status = 'merged';
  await logStep('merged', '升級已自動合併至 main！Cloudflare 約 30 秒後完成自動部署上線。');
}

main().catch(async (err) => {
  record.status = 'failed';
  record.error = err instanceof Error ? err.message : String(err);
  await logStep('failed', `任務失敗：${record.error}`);
  process.exit(1);
});