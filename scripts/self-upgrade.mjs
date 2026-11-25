import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const PROTECTED_CORE_TOOLS = [
  'get_current_time',
  'manage_todos',
  'fetch_webpage',
  'request_self_upgrade',
  'check_upgrade_status',
];

const MODEL_TIMEOUT_MS = 10 * 60 * 1000; // 單一模型最多容忍 10 分鐘
const HEARTBEAT_INTERVAL_MS = 20 * 1000; // 每 20 秒更新一次心跳與字數進度

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
  try {
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
  } catch {
    return null;
  }
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

// 原地更新最後一行心跳狀態，避免洗版 20 行日誌緩衝區
async function updateHeartbeat(message) {
  const line = `[${formatTime()}] 💓 ${message}`;
  console.log(`(heartbeat) ${line}`);
  record.step = 'generating_code';
  if (record.logs.length > 0 && record.logs[record.logs.length - 1].includes('💓')) {
    record.logs[record.logs.length - 1] = line;
  } else {
    record.logs = [...record.logs, line].slice(-20);
  }
  record.updated_at = new Date().toISOString();
  await redisCmd(['SET', `upgrade:${userId}`, JSON.stringify(record)]);
}

function readEditableFiles() {
  const files = {};
  const pluginsDir = path.resolve('src/plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });

  for (const name of fs.readdirSync(pluginsDir)) {
    if (name.endsWith('.ts')) {
      files[`src/plugins/${name}`] = fs.readFileSync(path.join(pluginsDir, name), 'utf8');
    }
  }
  if (!files['src/plugins/registry.ts']) {
    files['src/plugins/registry.ts'] =
      "import type { PluginTool } from '../types';\n\nexport const CUSTOM_PLUGINS: PluginTool[] = [];\n";
  }

  const uiPath = path.resolve('src/ui.ts');
  if (fs.existsSync(uiPath)) {
    files['src/ui.ts'] = fs.readFileSync(uiPath, 'utf8');
  }

  return files;
}

function validateUiContent(content) {
  if (!/\bexport\s+const\s+CHAT_HTML\b/.test(content)) {
    throw new Error('安全攔截：src/ui.ts 必須匯出 export const CHAT_HTML');
  }

  const transpiled = ts.transpileModule(content, {
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const tsErrors = (transpiled.diagnostics || []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  if (tsErrors.length > 0) {
    const msg = ts.flattenDiagnosticMessageText(tsErrors[0].messageText, '\n');
    throw new Error(`安全攔截：src/ui.ts 語法錯誤（請檢查模板字串跳脫）：${msg}`);
  }

  const sandbox = { exports: {}, module: { exports: {} } };
  try {
    vm.runInNewContext(transpiled.outputText, sandbox, { timeout: 1000 });
  } catch (err) {
    throw new Error(
      `安全攔截：src/ui.ts 無法獨立載入（禁止外部 import 或執行期錯誤）：${err instanceof Error ? err.message : String(err)}`
    );
  }

  const html = sandbox.exports.CHAT_HTML ?? sandbox.module.exports.CHAT_HTML;
  if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) {
    throw new Error('安全攔截：CHAT_HTML 必須為完整 HTML 字串');
  }

  const requiredTokens = ['/v1/pet/interact', '/v1/pet/upgrade/status', 'pet_bff_token'];
  for (const token of requiredTokens) {
    if (!html.includes(token)) {
      throw new Error(`安全攔截：src/ui.ts 缺少必要的核心連線介面 (${token})，已中止修改以避免頁面失效`);
    }
  }

  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;
  while ((match = scriptRegex.exec(html)) !== null) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const scriptCode = match[2].trim();
    if (!scriptCode) continue;
    scriptIndex += 1;

    const checked = ts.transpileModule(scriptCode, {
      reportDiagnostics: true,
      compilerOptions: {
        allowJs: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    });
    const jsErrors = (checked.diagnostics || []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error
    );
    if (jsErrors.length > 0) {
      const msg = ts.flattenDiagnosticMessageText(jsErrors[0].messageText, '\n');
      throw new Error(`安全攔截：src/ui.ts 第 ${scriptIndex} 個 <script> 區塊語法錯誤：${msg}`);
    }
  }
}

function validateOperations(ops) {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('升級計畫未包含任何有效檔案變更');
  }
  const allowedPluginRegex = /^src\/plugins\/[a-z][a-z0-9-]*\.ts$/;
  const coreNameRegex = new RegExp(`name\\s*:\\s*['"](${PROTECTED_CORE_TOOLS.join('|')})['"]`);

  for (const op of ops) {
    const isUi = op.path === 'src/ui.ts';
    const isPlugin = allowedPluginRegex.test(op.path);

    if (!isUi && !isPlugin) {
      throw new Error(`安全攔截：禁止修改核心或未授權路徑 (${op.path})`);
    }
    if ((op.path === 'src/plugins/registry.ts' || isUi) && op.action === 'delete') {
      throw new Error(`安全攔截：禁止刪除核心必要檔案 (${op.path})`);
    }
    if (op.action === 'upsert') {
      if (!op.content || op.content.trim().length < 10) {
        throw new Error(`檔案內容無效：${op.path}`);
      }
      if (/\b(eval|new Function)\b/.test(op.content)) {
        throw new Error(`安全攔截：${op.path} 包含不允許的動態執行語法`);
      }
      if (isUi) {
        validateUiContent(op.content);
      } else if (op.path !== 'src/plugins/registry.ts' && coreNameRegex.test(op.content)) {
        throw new Error(`安全攔截：插件 ${op.path} 不可使用核心保留工具名稱`);
      }
    }
  }
}

function buildStreamEndpoint(model) {
  const host =
    location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
}

// 解析 Vertex AI SSE 串流，同時累積思考字數與最終輸出字數
async function readSseStream(res, progress) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let textOutput = '';

  const consumeLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const jsonStr = line.slice(5).trim();
    if (!jsonStr || jsonStr === '[DONE]') return;

    try {
      const chunk = JSON.parse(jsonStr);
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) {
        if (p.thought && p.text) {
          progress.thoughtChars += p.text.length;
        } else if (!p.thought && p.text) {
          textOutput += p.text;
          progress.outputChars += p.text.length;
        }
      }
    } catch {
      // 忽略非完整 JSON 行
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      consumeLine(line);
    }
  }

  const tail = buffer + decoder.decode();
  if (tail.trim()) {
    for (const line of tail.split('\n')) {
      consumeLine(line);
    }
  }

  return textOutput
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function generatePlan(editableFiles) {
  const existingFilesText = Object.entries(editableFiles)
    .map(([filePath, content]) => `--- FILE: ${filePath} ---\n${content}`)
    .join('\n\n');

  const systemPrompt = [
    '你是這隻 TypeScript Cloudflare Workers AI 桌寵的「自我升級架構師」。',
    '你的任務是根據主人的需求，在允許範圍內新增、修改或刪除「自訂插件工具 (src/plugins/*.ts)」或更新「PWA 前端介面 (src/ui.ts)」。',
    '',
    '【最高安全與核心保護規則】',
    `1. 絕對不可損害或刪除核心功能（核心工具包含：${PROTECTED_CORE_TOOLS.join(', ')}，以及對話記憶、路由、自我升級本身）。`,
    '2. 如果主人要求刪除或破壞核心功能，必須回傳 {"rejected": true, "reject_reason": "原因說明", "summary": "", "operations": []}。',
    '3. 你只能操作 src/plugins/*.ts（檔名限小寫英文、數字與連字號）與 src/ui.ts，且絕不可刪除 src/plugins/registry.ts 或 src/ui.ts。',
    '4. 新增或刪除任何插件檔時，必須同步更新 src/plugins/registry.ts，確保所有 import 與 CUSTOM_PLUGINS 陣列完全一致。',
    '5. 新插件工具名稱（declaration.name）只能用 snake_case 英文，且不可與核心工具同名。',
    '6. 執行環境為 Cloudflare Workers（不可使用 Node fs 模組或未安裝的第三方套件），後端僅可使用標準 Web API（fetch, URL, Intl, crypto）與純 TypeScript。',
    '7. 程式碼必須完全符合 TypeScript strict mode（無 any、無未使用變數）。',
    '8. 修改 src/ui.ts 的強制規範：',
    '   - 必須保留無外部 import 的 `export const CHAT_HTML = ...`，並保留呼叫 `/v1/pet/interact`、`/v1/pet/upgrade/status`、Token 設定彈窗與 localStorage (`pet_bff_token`, `pet_user_id`)。',
    '   - 留意 `CHAT_HTML` 是 TypeScript 模板字串（反引號包覆），內部 JS 若有反引號、`${` 或 `\\n` 必須正確跳脫，建議內部 JS 優先用單/雙引號與字串相加，避免跳脫錯誤。',
    '   - 若需求僅涉及後端工具，請勿輸出 src/ui.ts；若僅涉及外觀與前端互動，請勿改動 src/plugins/。',
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
    '{"rejected": false, "summary": "繁體中文簡述本次變更", "operations": [{"action": "upsert", "path": "src/ui.ts", "content": "完整檔案程式碼"}]}',
  ].join('\n');

  const userPrompt = [
    '【目前可升級檔案的完整內容】',
    existingFilesText,
    '',
    `【主人的升級需求】\n${instruction}`,
  ].join('\n');

  const errors = [];

  for (const model of candidateModels) {
    await logStep('generating_code', `GitHub Actions 正在呼叫 ${model}（SSE 串流，最長等待 10 分鐘）...`);

    const generationConfig = model.startsWith('gemini-4')
      ? {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: true },
        }
      : {
          responseMimeType: 'application/json',
          temperature: 0.2,
        };

    const progress = { thoughtChars: 0, outputChars: 0, startedAt: Date.now() };
    const heartbeatTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - progress.startedAt) / 1000);
      void updateHeartbeat(
        `${model} 執行中（${sec}s｜思考 ${progress.thoughtChars} 字｜輸出 ${progress.outputChars} 字）`
      );
    }, HEARTBEAT_INTERVAL_MS);

    try {
      const res = await fetch(buildStreamEndpoint(model), {
        method: 'POST',
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig,
        }),
      });

      if (res.ok && res.body) {
        const rawText = await readSseStream(res, progress);
        if (!rawText) {
          throw new Error(`${model} 串流結束但未回傳有效 JSON 內容`);
        }
        await logStep(
          'code_generated',
          `${model} 已完成程式碼生成（思考 ${progress.thoughtChars} 字，輸出 ${progress.outputChars} 字）`
        );
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
      await logStep('model_fallback', `${model} 發生異常 (${msg.slice(0, 80)})，切換備援`);
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  throw new Error(`所有升級模型皆無法使用：${errors.join(' | ')}`);
}

async function main() {
  await initRecordFromRedis();
  await logStep('actions_started', 'GitHub Actions 遠端環境已就緒，開始讀取插件與 UI 檔案...');

  if (!apiKey || !projectId || !instruction) {
    throw new Error('缺少必要參數（GOOGLE_CLOUD_API_KEY / GCP_PROJECT_ID / instruction）');
  }

  const editableFiles = readEditableFiles();
  await logStep('files_loaded', `已讀取 ${Object.keys(editableFiles).length} 個可升級檔案（含 UI）`);

  const { plan, modelUsed } = await generatePlan(editableFiles);

  if (plan.rejected) {
    record.status = 'rejected';
    record.error = plan.reject_reason || '此操作可能影響核心功能，已拒絕執行';
    await logStep('rejected', `安全攔截：${record.error}`);
    return;
  }

  await logStep('validating', '正在執行安全白名單、UI 契約與內嵌腳本語法檢查...');
  validateOperations(plan.operations);

  for (const op of plan.operations) {
    const absPath = path.resolve(op.path);
    if (op.action === 'delete') {
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    } else {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, op.content, 'utf8');
    }
  }

  await logStep('type_checking', '正在執行 npx tsc --noEmit 型別安全檢查...');
  try {
    execFileSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`.trim().slice(0, 500);
    throw new Error(`TypeScript 編譯未通過，已中止升級：\n${output}`);
  }
  await logStep('type_check_passed', 'TypeScript 型別與 UI 檢查全數通過！');

  const statusOut = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (!statusOut) {
    throw new Error('程式碼與現有版本完全相同，無需提交變更');
  }

  const branchName = `self-upgrade/${Date.now()}`;
  execFileSync('git', ['config', 'user.name', 'Gemini Pet Bot']);
  execFileSync('git', ['config', 'user.email', 'gemini-pet-bot@users.noreply.github.com']);
  execFileSync('git', ['checkout', '-b', branchName]);
  execFileSync('git', ['add', '--', 'src/plugins', 'src/ui.ts']);
  execFileSync('git', ['commit', '-m', `feat(self-upgrade): ${plan.summary}`]);

  await logStep('pushing_pr', `正在推送分支 ${branchName} 並建立 Pull Request...`);
  execFileSync('git', ['push', 'origin', branchName]);

  const prBody = [
    `由 **${modelUsed}** 在 GitHub Actions 產生，已通過安全路徑白名單、UI 契約與 \`tsc --noEmit\` 檢查。`,
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
  await logStep('merged', '升級已自動合併至 main！Cloudflare 約 30 秒後完成自動部署，重新整理頁面即可看到新介面。');
}

main().catch(async (err) => {
  record.status = 'failed';
  record.error = err instanceof Error ? err.message : String(err);
  await logStep('failed', `任務失敗：${record.error}`);
  process.exit(1);
});