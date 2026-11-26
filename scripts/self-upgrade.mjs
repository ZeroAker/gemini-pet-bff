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

const MODEL_TIMEOUT_MS = 10 * 60 * 1000; // 單次模型請求最多 10 分鐘
const HEARTBEAT_INTERVAL_MS = 20 * 1000; // 每 20 秒回寫心跳進度
const MAX_HEAL_ATTEMPTS = 3; // 驗證或編譯失敗時，最多自動修復 3 輪
const MAX_TIMEOUT_RETRIES = 1; // 同一模型逾時後最多原地重試 1 次（合共 2 次機會）
const TIMEOUT_RETRY_DELAY_MS = 5 * 1000; // 逾時重試前冷卻 5 秒

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTimeoutError(err) {
  const name = err?.name || '';
  const msg = err instanceof Error ? err.message : String(err);
  const causeCode = err?.cause?.code || err?.code || '';
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT'].includes(causeCode) ||
    /timeout|timed out|aborted/i.test(msg)
  );
}

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
  record.logs = [...record.logs, line].slice(-25);
  record.updated_at = new Date().toISOString();
  await redisCmd(['SET', `upgrade:${userId}`, JSON.stringify(record)]);
}

async function updateHeartbeat(message) {
  const line = `[${formatTime()}] 💓 ${message}`;
  console.log(`(heartbeat) ${line}`);
  record.step = 'generating_code';
  if (record.logs.length > 0 && record.logs[record.logs.length - 1].includes('💓')) {
    record.logs[record.logs.length - 1] = line;
  } else {
    record.logs = [...record.logs, line].slice(-25);
  }
  record.updated_at = new Date().toISOString();
  await redisCmd(['SET', `upgrade:${userId}`, JSON.stringify(record)]);
}

// 讀取所有允許修改的檔案：src/plugins/*.ts、src/ui.ts、src/ui/*.ts
function readEditableFiles() {
  const files = {};

  const pluginsDir = path.resolve('src/plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  for (const name of fs.readdirSync(pluginsDir).sort()) {
    if (name.endsWith('.ts')) {
      files[`src/plugins/${name}`] = fs.readFileSync(path.join(pluginsDir, name), 'utf8');
    }
  }
  if (!files['src/plugins/registry.ts']) {
    files['src/plugins/registry.ts'] =
      "import type { PluginTool } from '../types';\n\nexport const CUSTOM_PLUGINS: PluginTool[] = [];\n";
  }

  const uiEntry = path.resolve('src/ui.ts');
  if (fs.existsSync(uiEntry)) {
    files['src/ui.ts'] = fs.readFileSync(uiEntry, 'utf8');
  }

  const uiDir = path.resolve('src/ui');
  if (fs.existsSync(uiDir) && fs.statSync(uiDir).isDirectory()) {
    for (const name of fs.readdirSync(uiDir).sort()) {
      if (name.endsWith('.ts')) {
        files[`src/ui/${name}`] = fs.readFileSync(path.join(uiDir, name), 'utf8');
      }
    }
  }

  return files;
}

// 讀取唯讀核心檔案，讓模型對齊型別、API 路由與工具介面（受白名單保護，嚴禁修改）
function readReadOnlyFiles() {
  const targets = ['src/types.ts', 'src/index.ts', 'src/tools.ts'];
  const files = {};
  for (const relPath of targets) {
    const absPath = path.resolve(relPath);
    if (fs.existsSync(absPath)) {
      files[relPath] = fs.readFileSync(absPath, 'utf8');
    }
  }
  return files;
}

// 重置本地工作區（用於自我修復重試前清理上一輪失敗改動）
function resetWorkspace() {
  execFileSync('git', ['reset', '--hard', 'HEAD'], { stdio: 'pipe' });
  execFileSync('git', ['clean', '-fd', '--', 'src/plugins', 'src/ui'], { stdio: 'pipe' });
}

function isAllowedPath(filePath) {
  if (filePath === 'src/ui.ts') return true;
  if (/^src\/ui\/[a-z][a-z0-9-]*\.ts$/.test(filePath)) return true;
  if (/^src\/plugins\/[a-z][a-z0-9-]*\.ts$/.test(filePath)) return true;
  return false;
}

function isUiPath(filePath) {
  return filePath === 'src/ui.ts' || filePath.startsWith('src/ui/');
}

// 第一道驗證：檢查操作路徑與欄位格式
function validateOperationRules(ops) {
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new Error('升級計畫未包含任何有效檔案變更（operations 不可為空）');
  }

  for (const op of ops) {
    if (!op || typeof op.path !== 'string' || !isAllowedPath(op.path)) {
      throw new Error(`安全攔截：禁止修改核心或未授權路徑 (${op?.path || 'unknown'})`);
    }

    if ((op.path === 'src/plugins/registry.ts' || op.path === 'src/ui.ts') && op.action === 'delete') {
      throw new Error(`安全攔截：禁止刪除核心必要檔案 (${op.path})`);
    }

    if (op.action === 'upsert') {
      if (typeof op.content !== 'string' || op.content.trim().length < 10) {
        throw new Error(`檔案內容無效（upsert 缺少 content）：${op.path}`);
      }
    } else if (op.action === 'patch') {
      if (!Array.isArray(op.patches) || op.patches.length === 0) {
        throw new Error(`Patch 格式無效（缺少 patches 陣列）：${op.path}`);
      }
    } else if (op.action !== 'delete') {
      throw new Error(`不支援的 action 類型：${String(op.action)}（僅限 upsert / patch / delete）`);
    }
  }
}

// 寫入磁碟（支援 upsert、精準單點 patch、delete）並回傳被寫入的檔案清單
function applyOperationsToDisk(ops) {
  const touchedPaths = new Set();

  for (const op of ops) {
    const absPath = path.resolve(op.path);

    if (op.action === 'delete') {
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
      continue;
    }

    if (op.action === 'upsert') {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, op.content, 'utf8');
      touchedPaths.add(op.path);
      continue;
    }

    if (op.action === 'patch') {
      if (!fs.existsSync(absPath)) {
        throw new Error(`Patch 失敗：目標檔案 ${op.path} 不存在，新增檔案請改用 action: "upsert"`);
      }

      let content = fs.readFileSync(absPath, 'utf8');
      for (let i = 0; i < op.patches.length; i += 1) {
        const patch = op.patches[i];
        if (!patch || typeof patch.search !== 'string' || patch.search.length === 0 || typeof patch.replace !== 'string') {
          throw new Error(`Patch 格式錯誤 (${op.path} 第 ${i + 1} 段)：search 必須為非空字串，replace 必須為字串`);
        }

        const firstIdx = content.indexOf(patch.search);
        if (firstIdx === -1) {
          throw new Error(
            `Patch 失敗 (${op.path} 第 ${i + 1} 段)：找不到指定的 search 原文片段，請精準對齊縮排與換行，或改用 action: "upsert"`
          );
        }

        const secondIdx = content.indexOf(patch.search, firstIdx + 1);
        if (secondIdx !== -1) {
          throw new Error(
            `Patch 失敗 (${op.path} 第 ${i + 1} 段)：search 原文片段命中超過一次，請多包含前後 2~3 行上下文以確保唯一匹配`
          );
        }

        content = content.slice(0, firstIdx) + patch.replace + content.slice(firstIdx + patch.search.length);
      }

      fs.writeFileSync(absPath, content, 'utf8');
      touchedPaths.add(op.path);
    }
  }

  return Array.from(touchedPaths);
}

// 第二道驗證：對寫入／Patch 後的最終檔案執行安全掃描
function validateTouchedContents(touchedPaths) {
  const coreNameRegex = new RegExp(`name\\s*:\\s*['"](${PROTECTED_CORE_TOOLS.join('|')})['"]`);

  for (const relPath of touchedPaths) {
    const content = fs.readFileSync(path.resolve(relPath), 'utf8');
    if (/\b(eval|new Function)\b/.test(content)) {
      throw new Error(`安全攔截：${relPath} 包含不允許的動態執行語法 (eval / new Function)`);
    }
    if (
      relPath.startsWith('src/plugins/') &&
      relPath !== 'src/plugins/registry.ts' &&
      coreNameRegex.test(content)
    ) {
      throw new Error(`安全攔截：插件 ${relPath} 不可使用核心保留工具名稱`);
    }
  }
}

// 第三道驗證：跨檔動態組裝 src/ui.ts + src/ui/*.ts，檢查核心連線契約與內嵌 <script> 語法
function validateWorkspaceUi() {
  const uiEntry = path.resolve('src/ui.ts');
  const uiDir = path.resolve('src/ui');

  if (!fs.existsSync(uiEntry)) {
    throw new Error('安全攔截：缺少必要核心檔案 src/ui.ts');
  }

  const moduleCache = new Map();

  function resolveLocalUiModule(fromFile, specifier) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      throw new Error(`安全攔截：UI 模組禁止引入外部套件 (${specifier})`);
    }
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];
    const found = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!found) {
      throw new Error(`UI 模組找不到 import 目標：${specifier}（來自 ${path.relative(process.cwd(), fromFile)}）`);
    }
    const allowed = found === uiEntry || found.startsWith(uiDir + path.sep);
    if (!allowed) {
      throw new Error(`安全攔截：UI 模組僅允許引入 src/ui/*，禁止存取 ${path.relative(process.cwd(), found)}`);
    }
    return found;
  }

  function loadTsModule(absFile) {
    if (moduleCache.has(absFile)) return moduleCache.get(absFile);

    const source = fs.readFileSync(absFile, 'utf8');
    const transpiled = ts.transpileModule(source, {
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    });

    const tsErrors = (transpiled.diagnostics || []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error
    );
    if (tsErrors.length > 0) {
      const rel = path.relative(process.cwd(), absFile);
      const msg = ts.flattenDiagnosticMessageText(tsErrors[0].messageText, '\n');
      throw new Error(`UI 檔案語法錯誤 (${rel})：${msg}`);
    }

    const mod = { exports: {} };
    moduleCache.set(absFile, mod.exports);
    const sandbox = {
      exports: mod.exports,
      module: mod,
      require: (specifier) => loadTsModule(resolveLocalUiModule(absFile, specifier)),
    };

    try {
      vm.runInNewContext(transpiled.outputText, sandbox, { timeout: 1000 });
    } catch (err) {
      const rel = path.relative(process.cwd(), absFile);
      throw new Error(`UI 模組載入失敗 (${rel})：${err instanceof Error ? err.message : String(err)}`);
    }

    moduleCache.set(absFile, mod.exports);
    return mod.exports;
  }

  const uiExports = loadTsModule(uiEntry);
  const html = uiExports.CHAT_HTML;

  if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) {
    throw new Error('安全攔截：src/ui.ts 必須匯出完整 HTML 字串 export const CHAT_HTML');
  }

  const requiredTokens = ['/v1/pet/interact', '/v1/pet/upgrade/status', 'pet_bff_token'];
  for (const token of requiredTokens) {
    if (!html.includes(token)) {
      throw new Error(`安全攔截：組裝後的 CHAT_HTML 缺少必要核心連線標記 (${token})，已中止以避免頁面失效`);
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
      throw new Error(`UI 第 ${scriptIndex} 個內嵌 <script> 語法錯誤：${msg}`);
    }
  }
}

// 第四道驗證：全專案 TypeScript strict mode 檢查
function runTypeCheck() {
  try {
    execFileSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`.trim().slice(0, 2000);
    throw new Error(`TypeScript (tsc --noEmit) 編譯失敗：\n${output}`);
  }
}

function buildStreamEndpoint(model) {
  const host =
    location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
}

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
    for (const line of lines) consumeLine(line);
  }

  const tail = buffer + decoder.decode();
  if (tail.trim()) {
    for (const line of tail.split('\n')) consumeLine(line);
  }

  return textOutput
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function buildSystemPrompt() {
  return [
    '你是這隻 TypeScript Cloudflare Workers AI 桌寵的「自我升級架構師」。',
    '你的任務是根據主人的需求，在允許範圍內新增、局部修改、重寫或刪除「自訂插件工具 (src/plugins/*.ts)」與「PWA 前端介面 (src/ui.ts 及 src/ui/*.ts)」。',
    '',
    '【最高安全與核心保護規則】',
    `1. 絕對不可損害或刪除核心功能（核心工具包含：${PROTECTED_CORE_TOOLS.join(', ')}，以及對話記憶、路由、自我升級本身）。`,
    '2. 若主人要求刪除或破壞核心功能，必須回傳 {"rejected": true, "reject_reason": "原因說明", "summary": "", "operations": []}。',
    '3. 僅可操作以下白名單路徑：',
    '   - src/plugins/[a-z][a-z0-9-]*.ts（禁止刪除 src/plugins/registry.ts）',
    '   - src/ui.ts（禁止刪除）與 src/ui/[a-z][a-z0-9-]*.ts（UI 拆檔模組，僅允許互相相對 import）',
    '4. 新增或刪除任何插件檔時，必須同步更新 src/plugins/registry.ts，確保所有 import 與 CUSTOM_PLUGINS 陣列一致。',
    '5. 新插件工具名稱（declaration.name）只能用 snake_case 英文，且不可與核心工具同名。',
    '6. 後端執行環境為 Cloudflare Workers（不可使用 Node fs 模組或未安裝的第三方套件），僅可使用標準 Web API 與純 TypeScript strict mode（無 any、無未使用變數）。',
    '7. UI 介面強制規範：',
    '   - src/ui.ts 最終必須匯出完整 HTML 字串 `export const CHAT_HTML: string`（可由 src/ui/styles.ts、body.ts、script.ts 等拆檔模組組裝）。',
    '   - 組裝後的 HTML 必須保留呼叫 `/v1/pet/interact`、`/v1/pet/upgrade/status`、Token 設定彈窗與 localStorage (`pet_bff_token`, `pet_user_id`)。',
    '   - 若在 TypeScript 模板字串內寫前端 JS，務必留意反引號、`${` 與 `\\n` 跳脫；建議前端 JS 優先使用單引號與字串拼接避免語法錯誤。',
    '',
    '【局部修改 vs 整檔輸出策略】',
    '- 對現有檔案做小範圍修改（改樣式、加按鈕、修 Bug）時，優先使用 `action: "patch"` 並提供精準的 `search`（含前後 2~3 行上下文確保唯一匹配）與 `replace`，大幅提升速度且避免誤刪既有功能。',
    '- 新增檔案或進行大型架構重構（如 UI 拆檔）時，使用 `action: "upsert"` 輸出完整檔案內容。',
    '- 若需求僅涉及後端工具，切勿改動 UI；若僅涉及 UI，切勿改動插件。',
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
    '【輸出格式】嚴格回傳合法 JSON（不可夾雜解說文字）：',
    '{',
    '  "rejected": false,',
    '  "summary": "繁體中文簡述本次變更",',
    '  "operations": [',
    '    { "action": "patch", "path": "src/ui/styles.ts", "patches": [{ "search": "原文片段", "replace": "替換片段" }] },',
    '    { "action": "upsert", "path": "src/plugins/example.ts", "content": "完整檔案程式碼" },',
    '    { "action": "delete", "path": "src/plugins/old.ts" }',
    '  ]',
    '}',
    '8. src/plugins/lifecycle.ts 為每小時 Cron 生理時鐘規則檔，嚴禁刪除且必須保留 export function computeNextLifecycleState(state: PetState, ctx: LifecycleContext): PetState。',
  ].join('\n');
}

async function callModelWithFallback(modelsOrder, systemPrompt, contents, attemptNum) {
  const errors = [];

  modelLoop: for (const model of modelsOrder) {
    const generationConfig = model.startsWith('gemini-4')
      ? {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: true },
        }
      : {
          responseMimeType: 'application/json',
          temperature: 0.2,
        };

    for (let retry = 0; retry <= MAX_TIMEOUT_RETRIES; retry += 1) {
      const retryTag = retry > 0 ? `（逾時重試 ${retry}/${MAX_TIMEOUT_RETRIES}）` : '';
      await logStep(
        'generating_code',
        `第 ${attemptNum}/${MAX_HEAL_ATTEMPTS} 輪：呼叫 ${model}${retryTag}（SSE 串流）...`
      );

      const progress = { thoughtChars: 0, outputChars: 0, startedAt: Date.now() };
      const heartbeatTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - progress.startedAt) / 1000);
        void updateHeartbeat(
          `[輪次 ${attemptNum}/${MAX_HEAL_ATTEMPTS}] ${model}${retryTag} 執行中（${sec}s｜思考 ${progress.thoughtChars} 字｜輸出 ${progress.outputChars} 字）`
        );
      }, HEARTBEAT_INTERVAL_MS);

      try {
        const res = await fetch(buildStreamEndpoint(model), {
          method: 'POST',
          signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig,
          }),
        });

        if (res.ok && res.body) {
          const rawText = await readSseStream(res, progress);
          if (!rawText) {
            throw new Error(`${model} 串流結束但未回傳有效內容`);
          }
          await logStep(
            'code_generated',
            `${model}${retryTag} 已生成方案（思考 ${progress.thoughtChars} 字，輸出 ${progress.outputChars} 字）`
          );
          return { rawText, modelUsed: model };
        }

        const errText = await res.text();
        errors.push(`[${model}${retryTag} -> ${res.status}] ${errText.slice(0, 150)}`);

        // HTTP 408 / 504 屬於伺服端逾時：先原地重試同一模型
        if ((res.status === 408 || res.status === 504) && retry < MAX_TIMEOUT_RETRIES) {
          await logStep(
            'model_timeout_retry',
            `${model} 伺服端逾時 (${res.status})，${TIMEOUT_RETRY_DELAY_MS / 1000} 秒後重試同一模型（${retry + 1}/${MAX_TIMEOUT_RETRIES}）...`
          );
          await sleep(TIMEOUT_RETRY_DELAY_MS);
          continue;
        }

        await logStep('model_fallback', `${model} 回傳 ${res.status}，切換備援模型`);

        if (![403, 404, 408, 429, 500, 502, 503, 504].includes(res.status)) {
          break modelLoop;
        }
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${model}${retryTag} 異常] ${msg}`);

        if (isTimeoutError(err) && retry < MAX_TIMEOUT_RETRIES) {
          await logStep(
            'model_timeout_retry',
            `${model} 發生逾時 (${msg.slice(0, 60)})，${TIMEOUT_RETRY_DELAY_MS / 1000} 秒後重試同一模型（${retry + 1}/${MAX_TIMEOUT_RETRIES}）...`
          );
          await sleep(TIMEOUT_RETRY_DELAY_MS);
          continue;
        }

        await logStep('model_fallback', `${model} 發生異常 (${msg.slice(0, 80)})，切換備援`);
        break;
      } finally {
        clearInterval(heartbeatTimer);
      }
    }
  }

  throw new Error(`所有升級模型皆無法使用：${errors.join(' | ')}`);
}

// 自我修復主迴圈：生成 -> 規則檢查 -> 寫入/Patch -> UI 沙盒驗證 -> tsc 檢查
async function generateAndVerifyWithHealing(editableFiles, readOnlyFiles) {
  const readOnlyFilesText = Object.entries(readOnlyFiles)
    .map(([filePath, content]) => `--- READ-ONLY FILE: ${filePath} ---\n${content}`)
    .join('\n\n');

  const existingFilesText = Object.entries(editableFiles)
    .map(([filePath, content]) => `--- FILE: ${filePath} ---\n${content}`)
    .join('\n\n');

  const systemPrompt = buildSystemPrompt();
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: [
            '【核心唯讀參考檔案（嚴禁出現在 operations 中，僅供對齊型別、API 路由與回傳欄位）】',
            readOnlyFilesText,
            '',
            '【目前所有可升級檔案的完整內容（允許修改的範圍）】',
            existingFilesText,
            '',
            `【主人的升級需求】\n${instruction}`,
          ].join('\n'),
        },
      ],
    },
  ];

  let activeModel = null;

  for (let attempt = 1; attempt <= MAX_HEAL_ATTEMPTS; attempt += 1) {
    const modelsOrder = activeModel
      ? Array.from(new Set([activeModel, ...candidateModels]))
      : candidateModels;

    const { rawText, modelUsed } = await callModelWithFallback(
      modelsOrder,
      systemPrompt,
      contents,
      attempt
    );
    activeModel = modelUsed;

    try {
      let plan;
      try {
        plan = JSON.parse(rawText);
      } catch (parseErr) {
        throw new Error(`回傳內容並非合法 JSON：${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
      }

      if (plan.rejected) {
        return { plan, modelUsed, attemptsUsed: attempt };
      }

      await logStep('validating', `第 ${attempt} 輪：執行白名單檢查並套用變更（支援 Patch）...`);
      validateOperationRules(plan.operations);
      const touchedPaths = applyOperationsToDisk(plan.operations);
      validateTouchedContents(touchedPaths);

      const touchedUi = plan.operations.some((op) => isUiPath(op.path));
      if (touchedUi) {
        await logStep('validating_ui', `第 ${attempt} 輪：執行 UI 跨檔組裝與內嵌 <script> 語法驗證...`);
        validateWorkspaceUi();
      }

      await logStep('type_checking', `第 ${attempt} 輪：執行 npx tsc --noEmit 全專案型別檢查...`);
      runTypeCheck();

      const statusOut = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
      if (!statusOut) {
        throw new Error('套用變更後檔案與現有版本完全相同，未產生任何實際差異');
      }

      await logStep('type_check_passed', `第 ${attempt} 輪驗證全數通過！`);
      return { plan, modelUsed, attemptsUsed: attempt };
    } catch (verifyErr) {
      const errMsg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      resetWorkspace();

      if (attempt >= MAX_HEAL_ATTEMPTS) {
        throw new Error(`經過 ${MAX_HEAL_ATTEMPTS} 輪自動修復仍無法通過驗證：${errMsg}`);
      }

      await logStep(
        'healing_retry',
        `第 ${attempt} 輪未通過（${errMsg.split('\n')[0].slice(0, 100)}），正回饋錯誤自動修復（進入第 ${attempt + 1}/${MAX_HEAL_ATTEMPTS} 輪）...`
      );

      // 將上一輪輸出與具體錯誤回饋給模型，進行下一輪自動修復
      contents.push({ role: 'model', parts: [{ text: rawText }] });
      contents.push({
        role: 'user',
        parts: [
          {
            text: [
              '你上一輪產出的升級方案未能通過自動驗證，工作區已完整還原為初始狀態。請針對以下錯誤修正並重新輸出「完整的合法 JSON 升級計畫」：',
              '',
              '【驗證錯誤訊息】',
              errMsg,
              '',
              '【修復提示】',
              '- 若為 Patch 找不到原文或重複命中，請補上準確上下文，或該檔案直接改用 action: "upsert"。',
              '- 若為 UI <script> 或 TypeScript 語法錯誤，請特別檢查模板字串跳脫、import 路徑與型別標註。',
            ].join('\n'),
          },
        ],
      });
    }
  }

  throw new Error('自我修復迴圈異常終止');
}

function stageAllowedPaths() {
  const candidates = ['src/plugins', 'src/ui', 'src/ui.ts'];
  const isTracked = (p) => {
    try {
      return execFileSync('git', ['ls-files', '--', p], { encoding: 'utf8' }).trim().length > 0;
    } catch {
      return false;
    }
  };
  const toAdd = candidates.filter((p) => fs.existsSync(path.resolve(p)) || isTracked(p));
  if (toAdd.length > 0) {
    execFileSync('git', ['add', '-A', '--', ...toAdd]);
  }
}

async function main() {
  await initRecordFromRedis();
  await logStep('actions_started', 'GitHub Actions 已就緒，正在讀取可升級檔案...');

  if (!apiKey || !projectId || !instruction) {
    throw new Error('缺少必要參數（GOOGLE_CLOUD_API_KEY / GCP_PROJECT_ID / instruction）');
  }

  const editableFiles = readEditableFiles();
  const readOnlyFiles = readReadOnlyFiles();
  await logStep(
    'files_loaded',
    `已讀取 ${Object.keys(editableFiles).length} 個可升級檔案，及 ${Object.keys(readOnlyFiles).length} 個唯讀參考檔案`
  );

  const { plan, modelUsed, attemptsUsed } = await generateAndVerifyWithHealing(
    editableFiles,
    readOnlyFiles
  );

  if (plan.rejected) {
    record.status = 'rejected';
    record.error = plan.reject_reason || '此操作可能影響核心功能，已拒絕執行';
    await logStep('rejected', `安全攔截：${record.error}`);
    return;
  }

  const branchName = `self-upgrade/${Date.now()}`;
  execFileSync('git', ['config', 'user.name', 'Gemini Pet Bot']);
  execFileSync('git', ['config', 'user.email', 'gemini-pet-bot@users.noreply.github.com']);
  execFileSync('git', ['checkout', '-b', branchName]);
  stageAllowedPaths();
  execFileSync('git', ['commit', '-m', `feat(self-upgrade): ${plan.summary}`]);

  await logStep('pushing_pr', `正在推送分支 ${branchName} 並建立 Pull Request...`);
  execFileSync('git', ['push', 'origin', branchName]);

  const healNote = attemptsUsed > 1 ? `（經第 ${attemptsUsed} 輪自動修復通過）` : '';
  const prBody = [
    `由 **${modelUsed}** 在 GitHub Actions 產生${healNote}，已通過安全路徑白名單、UI 沙盒組裝與 \`tsc --noEmit\` 檢查。`,
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
  await logStep(
    'merged',
    `升級已自動合併至 main${healNote}！Cloudflare 約 30 秒後完成自動部署，重新整理頁面即可看到新介面。`
  );
}

main().catch(async (err) => {
  record.status = 'failed';
  record.error = err instanceof Error ? err.message : String(err);
  await logStep('failed', `任務失敗：${record.error}`);
  process.exit(1);
});