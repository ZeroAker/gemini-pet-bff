import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const PROTECTED_CORE_TOOLS = [
  'get_current_time',
  'manage_todos',
  'fetch_webpage',
  'request_self_upgrade',
  'check_upgrade_status',
  'skill_view',
  'skill_manage',
];

const READ_ONLY_CORE_FILES = [
  'src/types.ts',
  'src/assets.d.ts',
  'src/index.ts',
  'src/middleware/auth.ts',
  'src/routes/pet-interact.ts',
  'src/tools.ts',
  'src/tools/builtin-handlers.ts',
  'src/services.ts',
  'src/services/redis-state.service.ts',
  'src/services/mem0-memory.service.ts',
  'src/services/gemini-agent.service.ts',
  'src/dream.ts',
  'src/upgrader.ts',
  'package.json',
  'tsconfig.json',
  'wrangler.toml',
];

const FORBIDDEN_SYSTEM_PATHS = [
  'scripts/self-upgrade.mjs',
  'scripts/nightly-dream.mjs',
  '.github/workflows/self-upgrade-runner.yml',
  '.github/workflows/nightly-dream.yml',
];

const PROTECTED_FILES = [
  'src/ui.ts',
  'src/ui/ui-module-types.ts',
  'src/ui/ui-events.ts',
  'src/plugins/registry.ts',
  'src/plugins/lifecycle.ts',
  'src/plugins/stickers.ts',
];

const STANDALONE_PLUGIN_FILES = new Set([
  'src/plugins/registry.ts',
  'src/plugins/lifecycle.ts',
  'src/plugins/stickers.ts',
]);

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 超過 5 分鐘完全無新 chunk 先判逾時
const HARD_TIMEOUT_MS = 20 * 60 * 1000; // 單一思考步驟總上限 20 分鐘
const PREFLIGHT_TIMEOUT_MS = 45 * 1000; // 前置安全與複雜度審查上限 45 秒
const HEARTBEAT_INTERVAL_MS = 20 * 1000; // 每 20 秒回寫一次心跳給 PWA
const REDIS_TIMEOUT_MS = 5 * 1000; // 單次 Redis HTTP 請求逾時 5 秒
const MAX_AGENT_TURNS = 60; // 最多執行 60 輪自主讀寫與修復步驟（含多檔架構修改與多輪除錯驗證）
const MAX_STEP_RETRIES = 2; // 同一模型遇到逾時/429/5xx 最多原地退避重試 2 次
const MAX_FORBIDDEN_ATTEMPTS = 2; // 連續觸碰禁改路徑達 2 次即提早熔斷終止
const DEFAULT_MAX_READ_LINES = 250;
const MAX_SEARCH_MATCHES = 30;
const KEEP_RECENT_TOOL_TURNS = 6;
const PRUNABLE_TOOLS = new Set(['read_file', 'search_in_file', 'run_checks']);
const READ_ONLY_TOOLS = new Set(['list_files', 'read_file', 'search_in_file']);
const CRITICAL_STEPS = new Set(['merged', 'rejected', 'failed', 'pr_created']);

const userId = (process.env.INPUT_USER_ID || 'zero_main').trim();
const instruction = (process.env.INPUT_INSTRUCTION || '').trim();
const apiKey = (process.env.GOOGLE_CLOUD_API_KEY || '').trim();
const projectId = (process.env.INPUT_GCP_PROJECT_ID || '').trim();
const location = (process.env.INPUT_GCP_LOCATION || 'global').trim();
const primaryModel = (process.env.INPUT_MODEL_UPGRADER || 'gemini-4-argon').trim();
const balancedModel = 'gemini-4-hydrogen';
const fastModel = 'gemini-3.8-flash';
const liteModel = 'gemini-3.5-flash-lite';
const baseBranch = (process.env.BASE_BRANCH || 'main').trim();
const redisUrl = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
const redisToken = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const repoFull = (process.env.GITHUB_REPOSITORY || '').trim();
const runId = (process.env.GITHUB_RUN_ID || '').trim();
const actionsUrl = repoFull && runId ? `https://github.com/${repoFull}/actions/runs/${runId}` : '';

const deepCandidateModels = Array.from(
  new Set([primaryModel, 'gemini-4-argon', balancedModel, fastModel, liteModel].filter(Boolean))
);
const balancedCandidateModels = Array.from(
  new Set([balancedModel, primaryModel, fastModel, liteModel].filter(Boolean))
);
const fastGateCandidateModels = Array.from(
  new Set([balancedModel, fastModel, liteModel].filter(Boolean))
);

const permanentlyUnavailableModels = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTimeoutError(err) {
  const name = err?.name || '';
  const msg = err instanceof Error ? err.message : String(err);
  const causeCode = err?.cause?.code || err?.code || '';
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET'].includes(causeCode) ||
    /timeout|timed out|aborted|premature close|socket hang up|econnreset/i.test(msg)
  );
}

function isRetryableHttpStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function computeRetryDelayMs(retryIndex, status = 0) {
  const baseMs = status === 429 ? 6000 : 3500;
  const jitterMs = Math.floor(Math.random() * 1500);
  return baseMs * Math.pow(2, retryIndex) + jitterMs;
}

function formatTime() {
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date());
}

async function redisCmd(args, options = {}) {
  if (!redisUrl || !redisToken) return null;
  const retries = options.retries ?? 0;
  const timeoutMs = options.timeoutMs ?? REDIS_TIMEOUT_MS;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(redisUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redisToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const data = await res.json();
        return data.result;
      }
    } catch {
      // 忽略單次 Redis 異常，視設定重試
    }
    if (attempt < retries) {
      await sleep(800 * (attempt + 1));
    }
  }
  return null;
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
    const raw = await redisCmd(['GET', `upgrade:${userId}`], { retries: 1 });
    if (raw) {
      const prev = JSON.parse(raw);
      if (Array.isArray(prev.logs)) record.logs = prev.logs;
      if (prev.started_at) record.started_at = prev.started_at;
    }
  } catch {
    // 忽略讀取異常
  }
}

async function logStep(step, message) {
  const line = `[${formatTime()}] ${message}`;
  console.log(`(${step}) ${line}`);
  record.step = step;
  record.logs = [...record.logs, line].slice(-25);
  record.updated_at = new Date().toISOString();
  const retries = CRITICAL_STEPS.has(step) ? 2 : 0;
  await redisCmd(['SET', `upgrade:${userId}`, JSON.stringify(record)], { retries });
}

let heartbeatInFlight = false;
async function updateHeartbeat(message) {
  if (heartbeatInFlight) return;
  heartbeatInFlight = true;
  try {
    const line = `[${formatTime()}] 💓 ${message}`;
    console.log(`(heartbeat) ${line}`);
    record.step = 'agent_thinking';
    if (record.logs.length > 0 && record.logs[record.logs.length - 1].includes('💓')) {
      record.logs[record.logs.length - 1] = line;
    } else {
      record.logs = [...record.logs, line].slice(-25);
    }
    record.updated_at = new Date().toISOString();
    await redisCmd(['SET', `upgrade:${userId}`, JSON.stringify(record)]);
  } finally {
    heartbeatInFlight = false;
  }
}

// 避免中間可修復的工具錯誤觸發前端 script.js 的 codeErrLogRe 而提前誤判整場升級失敗
function sanitizeIntermediateLogMessage(rawMsg) {
  return String(rawMsg || '')
    .split('\n')[0]
    .replace(/error\s+TS\d+/gi, 'TS診斷項')
    .replace(/編譯失敗|型別檢查.*失敗|型別錯誤|語法錯誤|語法驗證.*失敗|沙盒驗證.*失敗|安全掃描.*失敗/g, '待調整項目')
    .replace(/SyntaxError|TypeError/g, '診斷例外')
    .slice(0, 90);
}

// ============================================================================
// 路徑白名單、前置安全閘門與驗證層
// ============================================================================
function normalizeRelPath(inputPath) {
  if (typeof inputPath !== 'string') return '';
  return inputPath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function isEditablePath(relPath) {
  if (!relPath || relPath.includes('..')) return false;
  if (relPath === 'src/ui.ts') return true;
  if (/^src\/ui\/[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)?\.(ts|html|css|js)$/.test(relPath)) return true;
  if (/^src\/plugins\/[a-z][a-z0-9-]*\.ts$/.test(relPath)) return true;
  return false;
}

function isReadablePath(relPath) {
  return isEditablePath(relPath) || READ_ONLY_CORE_FILES.includes(relPath);
}

function isUiPath(relPath) {
  return relPath === 'src/ui.ts' || relPath.startsWith('src/ui/');
}

function collectUiFilesRecursive(dirAbs, baseRel = 'src/ui') {
  const results = [];
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) return results;
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entry of entries) {
    const rel = `${baseRel}/${entry.name}`;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectUiFilesRecursive(abs, rel));
    } else if (entry.isFile() && /\.(ts|html|css|js)$/.test(entry.name) && isEditablePath(rel)) {
      results.push(rel);
    }
  }
  return results;
}

function listProjectFiles() {
  const editable = [];

  const pluginsDir = path.resolve('src/plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  for (const name of fs.readdirSync(pluginsDir).sort()) {
    if (name.endsWith('.ts')) editable.push(`src/plugins/${name}`);
  }

  if (fs.existsSync(path.resolve('src/ui.ts'))) {
    editable.push('src/ui.ts');
  }

  const uiDir = path.resolve('src/ui');
  editable.push(...collectUiFilesRecursive(uiDir, 'src/ui'));

  const readOnly = READ_ONLY_CORE_FILES.filter((p) => fs.existsSync(path.resolve(p)));
  return { editable_files: editable, read_only_reference_files: readOnly };
}

// 第一道防線：確定性規則快速攔截明確要求修改禁區檔案或刪除受保護核心的指令
function checkDeterministicForbiddenIntent(rawInstruction) {
  const text = String(rawInstruction || '').trim();
  if (!text) return null;

  const deleteVerbRe = /(刪除|移除|刪掉|拿掉|清空|廢除|delete|remove|drop|unlink)/i;
  for (const protectedPath of PROTECTED_FILES) {
    if (text.includes(protectedPath) && deleteVerbRe.test(text)) {
      return `指令要求刪除受保護必要檔案 (${protectedPath})，已由安全閘門直接終止`;
    }
  }

  for (const coreTool of PROTECTED_CORE_TOOLS) {
    if (text.includes(coreTool) && deleteVerbRe.test(text)) {
      return `指令要求刪除或移除核心保留工具 (${coreTool})，已由安全閘門直接終止`;
    }
  }

  const mutateVerbRe = /(修改|改寫|編輯|覆寫|刪除|移除|新增套件|安裝套件|modify|edit|overwrite|delete|remove|rewrite)/i;
  const allForbiddenFiles = [...READ_ONLY_CORE_FILES, ...FORBIDDEN_SYSTEM_PATHS];
  const mentionsEditable = /(src\/plugins\/|src\/ui\/|src\/ui\.ts|插件|plugin|介面|UI)/i.test(text);

  for (const forbiddenPath of allForbiddenFiles) {
    if (text.includes(forbiddenPath) && mutateVerbRe.test(text) && !mentionsEditable) {
      return `指令要求直接修改唯讀核心或系統受保護檔案 (${forbiddenPath})，超出可編輯白名單範圍，已提早終止`;
    }
  }

  return null;
}

function validateFileSecurity(relPath, content) {
  if (/\.(ts|js|html)$/.test(relPath) && /\b(eval|new Function)\b/.test(content)) {
    throw new Error(`安全攔截：${relPath} 包含不允許的動態執行語法 (eval / new Function)`);
  }
  const coreNameRegex = new RegExp(`name\\s*:\\s*['"](${PROTECTED_CORE_TOOLS.join('|')})['"]`);
  if (
    relPath.startsWith('src/plugins/') &&
    relPath !== 'src/plugins/registry.ts' &&
    coreNameRegex.test(content)
  ) {
    throw new Error(`安全攔截：插件 ${relPath} 不可使用核心保留工具名稱`);
  }
}

function validatePluginRegistry(editableFiles) {
  const registryPath = path.resolve('src/plugins/registry.ts');
  if (!fs.existsSync(registryPath)) {
    throw new Error('安全攔截：缺少必要核心檔案 src/plugins/registry.ts');
  }
  const registryContent = fs.readFileSync(registryPath, 'utf8');
  const pluginFiles = editableFiles.filter(
    (rel) => rel.startsWith('src/plugins/') && rel.endsWith('.ts') && !STANDALONE_PLUGIN_FILES.has(rel)
  );

  for (const pluginRel of pluginFiles) {
    const baseName = path.basename(pluginRel, '.ts');
    const importRe = new RegExp(`from\\s+['"]\\.\\/${baseName}(?:\\.ts)?['"]`);
    if (!importRe.test(registryContent)) {
      throw new Error(
        `插件註冊檢查失敗：${pluginRel} 尚未在 src/plugins/registry.ts 中匯入並加入 CUSTOM_PLUGINS`
      );
    }
  }
}

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
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.html`,
      `${base}.css`,
      `${base}.js`,
      path.join(base, 'service.ts'),
      path.join(base, 'index.ts'),
    ];
    const found = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!found) {
      throw new Error(
        `UI 模組找不到 import 目標：${specifier}（來自 ${path.relative(process.cwd(), fromFile)}）`
      );
    }
    const allowed = found === uiEntry || found.startsWith(uiDir + path.sep);
    if (!allowed) {
      throw new Error(
        `安全攔截：UI 模組僅允許引入 src/ui/*，禁止存取 ${path.relative(process.cwd(), found)}`
      );
    }
    return found;
  }

  function loadTsModule(absFile) {
    if (moduleCache.has(absFile)) return moduleCache.get(absFile).exports;

    const source = fs.readFileSync(absFile, 'utf8');

    // 原生 .html、.css 與前端 .js 資源檔直接以 UTF-8 字串匯出（相容 ES default import 與 CJS require）
    if (absFile.endsWith('.html') || absFile.endsWith('.css') || absFile.endsWith('.js')) {
      moduleCache.set(absFile, { exports: source });
      return source;
    }

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
    moduleCache.set(absFile, mod);
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

    return mod.exports;
  }

  const uiExports = loadTsModule(uiEntry);
  const html = uiExports.CHAT_HTML;

  if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) {
    throw new Error('安全攔截：src/ui.ts 必須匯出完整 HTML 字串 export const CHAT_HTML');
  }

  const requiredTokens = [
    '/v1/pet/interact',
    '/v1/pet/upgrade/status',
    'pet_bff_token',
    'pet_user_id',
  ];
  for (const token of requiredTokens) {
    if (!html.includes(token)) {
      throw new Error(
        `安全攔截：組裝後的 CHAT_HTML 缺少必要核心連線標記 (${token})，已中止以避免頁面失效`
      );
    }
  }

  const requiredDomIds = ['chat', 'msgInput', 'sendBtn', 'upgradeBtn'];
  for (const domId of requiredDomIds) {
    const idRe = new RegExp(`id\\s*=\\s*["']${domId}["']`);
    if (!idRe.test(html)) {
      throw new Error(
        `安全攔截：組裝後的 CHAT_HTML 缺少必要核心 DOM 元素 (#${domId})，已中止以避免前端腳本崩潰`
      );
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

function getGitChangedFiles() {
  const out = execFileSync(
    'git',
    ['status', '--porcelain', '--', 'src/plugins', 'src/ui', 'src/ui.ts'],
    { encoding: 'utf8' }
  );
  return out
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const status = line.slice(0, 2).trim();
      const file = line.slice(3).trim().replace(/^"|"$/g, '');
      return `${status}:${file}`;
    });
}

function runAllChecks(session) {
  // 1. 檢查不可刪除核心檔案完整性，並僅針對本輪有修改過的檔案執行安全掃描（避免重複掃描未變動檔案）
  const { editable_files } = listProjectFiles();
  for (const protectedPath of PROTECTED_FILES) {
    if (!editable_files.includes(protectedPath) || !fs.existsSync(path.resolve(protectedPath))) {
      throw new Error(`安全攔截：缺少必要核心檔案 ${protectedPath}`);
    }
  }

  for (const relPath of session.modifiedPaths) {
    if (fs.existsSync(path.resolve(relPath))) {
      const content = fs.readFileSync(path.resolve(relPath), 'utf8');
      validateFileSecurity(relPath, content);
    }
  }

  // 2. 檢查所有自訂插件皆已正確掛載於 src/plugins/registry.ts
  validatePluginRegistry(editable_files);

  // 3. 若改動過 UI，執行跨檔組裝、契約、關鍵 DOM 與內嵌 JS 驗證
  if (session.uiTouched) {
    validateWorkspaceUi();
  }

  // 4. 執行全專案 TypeScript strict mode 檢查
  try {
    execFileSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`.trim().slice(0, 2500);
    throw new Error(`TypeScript (tsc --noEmit) 編譯失敗：\n${output}`);
  }

  // 5. 執行 Cloudflare Workers Wrangler dry-run 打包驗證，確保 esbuild 與資源載入無誤
  const dryRunOutDir = path.resolve('.wrangler/tmp-upgrade-check');
  try {
    execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', dryRunOutDir], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`.trim().slice(0, 2000);
    throw new Error(`Cloudflare Workers (wrangler deploy --dry-run) 打包驗證失敗：\n${output}`);
  } finally {
    try {
      fs.rmSync(dryRunOutDir, { recursive: true, force: true });
    } catch {
      // 忽略暫存目錄清理錯誤
    }
  }

  const changedFiles = getGitChangedFiles();
  return { changedFiles };
}

function resetWorkspace() {
  execFileSync('git', ['reset', '--hard', 'HEAD'], { stdio: 'pipe' });
  execFileSync('git', ['clean', '-fd', '--', 'src/plugins', 'src/ui'], { stdio: 'pipe' });
}

function execWithRetry(cmd, args, options = {}, maxRetries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return execFileSync(cmd, args, options);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const waitMs = 2000 * (attempt + 1);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
      }
    }
  }
  throw lastErr;
}

// ============================================================================
// Vertex AI Agent 工具定義與執行器（首輪已提供完整檔案清單，不重複暴露 list_files）
// ============================================================================
const AGENT_TOOL_DECLARATIONS = [
  {
    name: 'read_file',
    description:
      '讀取檔案內容（會附帶行號）。若未指定 start_line / end_line 且超過 250 行，預設僅回傳前 250 行；大型檔案請先用 search_in_file 定位再指定行號分段讀取。',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: '專案相對路徑，例如 src/ui.ts 或 src/types.ts' },
        start_line: { type: 'INTEGER', description: '起始行號（1 起算，選填）' },
        end_line: { type: 'INTEGER', description: '結束行號（含，選填）' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_in_file',
    description:
      '在白名單可讀檔案中搜尋關鍵字或正規表達式，回傳命中行號與前後 2 行上下文（單次最多 30 筆）。面對大型檔案應先用此工具定位再局部 read_file。',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: '專案相對路徑，例如 src/ui/core/script.js' },
        query: { type: 'STRING', description: '搜尋關鍵字或正規表達式字串' },
        is_regex: { type: 'BOOLEAN', description: '是否將 query 視為正規表達式（預設 false）' },
        case_sensitive: { type: 'BOOLEAN', description: '是否區分大小寫（預設 false）' },
      },
      required: ['path', 'query'],
    },
  },
  {
    name: 'write_file',
    description:
      '新增或整檔覆寫白名單內的可編輯檔案（src/plugins/*.ts、src/ui.ts、src/ui/**）。適合新增檔案或大型重構。',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: '目標檔案路徑（必須在可編輯白名單內）' },
        content: { type: 'STRING', description: '完整的檔案程式碼內容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'patch_file',
    description:
      '對既有白名單檔案執行精準單點替換。對小範圍修改優先使用此工具，每個 search 必須在目標檔案中剛好出現一次。',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: '目標檔案路徑' },
        patches: {
          type: 'ARRAY',
          description: '依序套用的替換清單',
          items: {
            type: 'OBJECT',
            properties: {
              search: { type: 'STRING', description: '原文片段（包含前後 2~3 行上下文確保唯一匹配）' },
              replace: { type: 'STRING', description: '替換後的新片段' },
            },
            required: ['search', 'replace'],
          },
        },
      },
      required: ['path', 'patches'],
    },
  },
  {
    name: 'delete_file',
    description: `刪除不再需要的自訂插件或 UI 子模組（嚴禁刪除受保護核心檔案：${PROTECTED_FILES.join('、')}）。`,
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: '要刪除的檔案路徑' },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_checks',
    description:
      '立即執行安全掃描、插件註冊檢查、UI 沙盒與 DOM 驗證、npx tsc --noEmit 型別檢查以及 wrangler 打包驗證。如有錯誤會回傳具體行號供你修正。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'finish_upgrade',
    description: '完成所有修改並確認驗證通過後呼叫。系統會自動執行最終檢查、建立分支、開 PR 並合併部署。',
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING', description: '繁體中文簡述本次升級內容（用於 Commit 與 PR 標題，30 字以內）' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'reject_upgrade',
    description:
      '當主人的需求會刪除或損害核心功能、或必須修改唯讀核心檔案／安裝外部套件才能達成時，立即呼叫此工具安全拒絕。',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: '繁體中文說明拒絕原因' },
      },
      required: ['reason'],
    },
  },
];

function recordForbiddenAttempt(session, targetPath, actionLabel) {
  session.forbiddenAttempts += 1;
  const reason = `禁止${actionLabel}核心或未授權路徑 (${targetPath})`;
  if (session.forbiddenAttempts >= MAX_FORBIDDEN_ATTEMPTS) {
    session.outcome = {
      type: 'reject',
      reason: `升級需求涉及核心禁止修改檔案 (${targetPath})，已觸發安全熔斷並提早終止`,
    };
  }
  return {
    ok: false,
    error: `安全攔截：${reason}。若主人的需求必須修改唯讀核心檔案才能達成，請立即呼叫 reject_upgrade 終止，嚴禁強行繞道或重試禁區檔案。`,
  };
}

async function executeTool(name, args, session, options = {}) {
  const silentLog = Boolean(options.silentLog);
  try {
    if (name === 'list_files') {
      if (!silentLog) await logStep('tool_list', '檢視專案檔案結構...');
      return { ok: true, ...listProjectFiles() };
    }

    if (name === 'read_file') {
      const relPath = normalizeRelPath(args.path);
      if (!isReadablePath(relPath)) {
        return { ok: false, error: `拒絕讀取未授權路徑：${relPath}` };
      }
      const absPath = path.resolve(relPath);
      if (!fs.existsSync(absPath)) {
        return { ok: false, error: `檔案不存在：${relPath}` };
      }
      const raw = fs.readFileSync(absPath, 'utf8');
      const lines = raw.split('\n');
      const totalLines = lines.length;
      const hasStart = args.start_line !== undefined && args.start_line !== null && args.start_line !== '';
      const hasEnd = args.end_line !== undefined && args.end_line !== null && args.end_line !== '';
      const start = Math.max(1, Number(args.start_line) || 1);
      let end = Math.min(totalLines, Number(args.end_line) || totalLines);
      let truncated = false;
      if (!hasStart && !hasEnd && totalLines > DEFAULT_MAX_READ_LINES) {
        end = DEFAULT_MAX_READ_LINES;
        truncated = true;
      }
      const sliced = lines
        .slice(start - 1, end)
        .map((text, idx) => `${start + idx}: ${text}`)
        .join('\n');

      session.readCount += 1;
      const logLabel = `讀取 ${relPath}（第 ${start}-${end} 行 / 共 ${totalLines} 行${truncated ? '，已截斷' : ''}）`;
      if (!silentLog) await logStep('tool_read', logLabel);
      return {
        ok: true,
        path: relPath,
        editable: isEditablePath(relPath),
        total_lines: totalLines,
        range: `${start}-${end}`,
        _logLabel: logLabel,
        ...(truncated
          ? {
              truncated: true,
              hint: `檔案共 ${totalLines} 行，未指定行號範圍預設僅回傳前 ${DEFAULT_MAX_READ_LINES} 行。請改用 search_in_file 定位行號，或指定 start_line / end_line 分段讀取。`,
            }
          : {}),
        content: sliced,
      };
    }

    if (name === 'search_in_file') {
      const relPath = normalizeRelPath(args.path);
      if (!isReadablePath(relPath)) {
        return { ok: false, error: `拒絕搜尋未授權路徑：${relPath}` };
      }
      const absPath = path.resolve(relPath);
      if (!fs.existsSync(absPath)) {
        return { ok: false, error: `檔案不存在：${relPath}` };
      }
      const query = typeof args.query === 'string' ? args.query : '';
      if (!query) {
        return { ok: false, error: '請提供非空的搜尋關鍵字或正規表達式 query' };
      }
      const isRegex = Boolean(args.is_regex);
      const caseSensitive = Boolean(args.case_sensitive);
      let regex = null;
      if (isRegex) {
        try {
          regex = new RegExp(query, caseSensitive ? '' : 'i');
        } catch (err) {
          return {
            ok: false,
            error: `無效的正規表達式：${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      const raw = fs.readFileSync(absPath, 'utf8');
      const lines = raw.split('\n');
      const needle = caseSensitive ? query : query.toLowerCase();
      const matches = [];
      let totalMatches = 0;

      for (let i = 0; i < lines.length; i += 1) {
        const lineText = lines[i];
        const hit = regex
          ? regex.test(lineText)
          : (caseSensitive ? lineText : lineText.toLowerCase()).includes(needle);
        if (!hit) continue;
        totalMatches += 1;
        if (matches.length < MAX_SEARCH_MATCHES) {
          const ctxStart = Math.max(0, i - 2);
          const ctxEnd = Math.min(lines.length - 1, i + 2);
          const context = [];
          for (let j = ctxStart; j <= ctxEnd; j += 1) {
            context.push(`${j + 1}: ${lines[j]}`);
          }
          matches.push({
            line: i + 1,
            context: context.join('\n'),
          });
        }
      }

      session.searchCount += 1;
      const logLabel = `搜尋 ${relPath}（「${query.slice(0, 30)}」，命中 ${totalMatches} 筆）`;
      if (!silentLog) await logStep('tool_search', logLabel);
      return {
        ok: true,
        path: relPath,
        total_lines: lines.length,
        total_matches: totalMatches,
        truncated: totalMatches > MAX_SEARCH_MATCHES,
        _logLabel: logLabel,
        matches,
      };
    }

    if (name === 'write_file') {
      const relPath = normalizeRelPath(args.path);
      if (!isEditablePath(relPath)) {
        return recordForbiddenAttempt(session, relPath, '寫入');
      }
      const content = typeof args.content === 'string' ? args.content : '';
      if (content.trim().length < 5) {
        return { ok: false, error: `寫入內容無效：${relPath}` };
      }
      validateFileSecurity(relPath, content);

      const absPath = path.resolve(relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, 'utf8');

      session.dirty = true;
      session.checksPassed = false;
      session.lastToolError = null;
      session.lastToolErrorType = null;
      session.consecutiveErrors = 0;
      if (isUiPath(relPath)) session.uiTouched = true;
      session.touchedFiles.add(`upsert:${relPath}`);
      session.modifiedPaths.add(relPath);

      await logStep('tool_write', `寫入檔案 ${relPath}（${content.split('\n').length} 行）`);
      return { ok: true, path: relPath, lines: content.split('\n').length };
    }

    if (name === 'patch_file') {
      const relPath = normalizeRelPath(args.path);
      if (!isEditablePath(relPath)) {
        return recordForbiddenAttempt(session, relPath, '修改');
      }
      const absPath = path.resolve(relPath);
      if (!fs.existsSync(absPath)) {
        return { ok: false, error: `目標檔案不存在 (${relPath})，新增檔案請用 write_file` };
      }
      const patches = Array.isArray(args.patches) ? args.patches : [];
      if (patches.length === 0) {
        return { ok: false, error: 'patches 不可為空陣列' };
      }

      let content = fs.readFileSync(absPath, 'utf8');
      for (let i = 0; i < patches.length; i += 1) {
        const p = patches[i];
        if (!p || typeof p.search !== 'string' || !p.search.length || typeof p.replace !== 'string') {
          return { ok: false, error: `第 ${i + 1} 段 patch 格式錯誤` };
        }
        const firstIdx = content.indexOf(p.search);
        if (firstIdx === -1) {
          session.lastToolError = `patch mismatch in ${relPath}`;
          session.lastToolErrorType = 'patch_mismatch';
          session.consecutiveErrors += 1;
          return {
            ok: false,
            error: `第 ${i + 1} 段 patch 在 ${relPath} 中找不到 search 原文，請先 read_file 確認精準縮排或改用 write_file`,
          };
        }
        const secondIdx = content.indexOf(p.search, firstIdx + 1);
        if (secondIdx !== -1) {
          session.lastToolError = `patch duplicate match in ${relPath}`;
          session.lastToolErrorType = 'patch_mismatch';
          session.consecutiveErrors += 1;
          return {
            ok: false,
            error: `第 ${i + 1} 段 patch 在 ${relPath} 中命中超過一次，請多加前後 2~3 行上下文`,
          };
        }
        content = content.slice(0, firstIdx) + p.replace + content.slice(firstIdx + p.search.length);
      }

      validateFileSecurity(relPath, content);
      fs.writeFileSync(absPath, content, 'utf8');

      session.dirty = true;
      session.checksPassed = false;
      session.lastToolError = null;
      session.lastToolErrorType = null;
      session.consecutiveErrors = 0;
      if (isUiPath(relPath)) session.uiTouched = true;
      session.touchedFiles.add(`patch:${relPath}`);
      session.modifiedPaths.add(relPath);

      await logStep('tool_patch', `局部更新 ${relPath}（套用 ${patches.length} 處 patch）`);
      return { ok: true, path: relPath, patches_applied: patches.length };
    }

    if (name === 'delete_file') {
      const relPath = normalizeRelPath(args.path);
      if (!isEditablePath(relPath)) {
        return recordForbiddenAttempt(session, relPath, '刪除');
      }
      if (PROTECTED_FILES.includes(relPath)) {
        return recordForbiddenAttempt(session, relPath, '刪除受保護必要');
      }
      const absPath = path.resolve(relPath);
      if (!fs.existsSync(absPath)) {
        return { ok: false, error: `檔案原本就不存在：${relPath}` };
      }
      fs.unlinkSync(absPath);

      session.dirty = true;
      session.checksPassed = false;
      session.lastToolError = null;
      session.lastToolErrorType = null;
      session.consecutiveErrors = 0;
      if (isUiPath(relPath)) session.uiTouched = true;
      session.touchedFiles.add(`delete:${relPath}`);
      session.modifiedPaths.delete(relPath);

      await logStep('tool_delete', `刪除檔案 ${relPath}`);
      return { ok: true, deleted: relPath };
    }

    if (name === 'run_checks') {
      await logStep('type_checking', '執行安全掃描、插件註冊、UI 沙盒、tsc 與 wrangler 打包檢查...');
      const { changedFiles } = runAllChecks(session);
      session.checksPassed = true;
      session.lastToolError = null;
      session.lastToolErrorType = null;
      session.consecutiveErrors = 0;
      await logStep('type_check_passed', `所有檢查全數通過！（變更 ${changedFiles.length} 個檔案）`);
      return { ok: true, passed: true, changed_files: changedFiles };
    }

    if (name === 'finish_upgrade') {
      const summary = String(args.summary || '').trim();
      if (!summary) {
        return { ok: false, error: '請提供 summary 簡述本次升級內容' };
      }
      // 無論 Agent 剛才有無手動跑過 run_checks，結束前都強制確保最新磁碟狀態通過檢查
      if (!session.checksPassed) {
        await logStep('type_checking', '結束前自動執行最終安全、型別與打包檢查...');
        const { changedFiles } = runAllChecks(session);
        if (changedFiles.length === 0) {
          return { ok: false, error: '目前工作區沒有任何實際檔案變更，無法結束升級' };
        }
        session.checksPassed = true;
      } else {
        const changedFiles = getGitChangedFiles();
        if (changedFiles.length === 0) {
          return { ok: false, error: '目前工作區沒有任何實際檔案變更，無法結束升級' };
        }
      }

      session.outcome = { type: 'finish', summary };
      return { ok: true, status: 'accepted_for_pr', summary };
    }

    if (name === 'reject_upgrade') {
      const reason = String(args.reason || '此操作可能影響核心功能或超出允許修改範圍，已拒絕執行').trim();
      session.outcome = { type: 'reject', reason };
      return { ok: true, status: 'rejected', reason };
    }

    return { ok: false, error: `未知工具：${name}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    session.lastToolError = msg;
    session.lastToolErrorType = 'check_error';
    session.consecutiveErrors += 1;
    const safeSummary = sanitizeIntermediateLogMessage(msg);
    await logStep('tool_retry_fix', `${name} 回報待修正項目，交由 Agent 自動修復：${safeSummary}`);
    return { ok: false, error: msg };
  }
}

// 同一輪若皆為唯讀工具（read_file / search_in_file），並行執行並合併為單一日誌，減少 Redis RTT 與洗版
async function executeTurnFunctionCalls(functionCalls, session) {
  const allReadOnly =
    functionCalls.length > 1 &&
    functionCalls.every((fc) => READ_ONLY_TOOLS.has(fc.functionCall?.name));

  if (allReadOnly) {
    const results = await Promise.all(
      functionCalls.map(async (fc) => {
        const call = fc.functionCall;
        const result = await executeTool(call.name, call.args || {}, session, { silentLog: true });
        const label = result._logLabel;
        delete result._logLabel;
        return { name: call.name, result, label };
      })
    );
    const labels = results.map((r) => r.label).filter(Boolean);
    if (labels.length > 0) {
      await logStep(
        'tool_read_batch',
        `並行讀取／搜尋 ${labels.length} 項：${labels.join('；').slice(0, 110)}`
      );
    }
    return results.map((r) => ({
      functionResponse: {
        name: r.name,
        response: r.result,
      },
    }));
  }

  const responseParts = [];
  for (const fc of functionCalls) {
    const call = fc.functionCall;
    const result = await executeTool(call.name, call.args || {}, session);
    delete result._logLabel;
    responseParts.push({
      functionResponse: {
        name: call.name,
        response: result,
      },
    });
    if (session.outcome) break;
  }
  return responseParts;
}

// ============================================================================
// Vertex AI node:https SSE 串流引擎（Idle Watchdog + 串流內錯誤偵測 + 保留 thoughtSignature）
// ============================================================================
function buildStreamEndpoint(model) {
  const host =
    location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
}

function streamVertexWithWatchdog(urlStr, payload, progress, options = {}) {
  const idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const hardTimeoutMs = options.hardTimeoutMs ?? HARD_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const bodyStr = JSON.stringify(payload);
    let settled = false;
    let idleTimer = null;
    let hardTimer = null;

    const cleanup = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (hardTimer) clearTimeout(hardTimer);
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const succeed = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const decoder = new TextDecoder('utf-8');

        if (status < 200 || status >= 300) {
          let errBody = '';
          res.on('data', (chunk) => {
            resetIdleTimer();
            errBody += decoder.decode(chunk, { stream: true });
          });
          res.on('end', () => {
            errBody += decoder.decode();
            succeed({ ok: false, status, errorText: errBody });
          });
          res.on('error', fail);
          return;
        }

        let buffer = '';
        const modelParts = [];
        let streamError = null;
        let lastFinishReason = '';
        let blockReason = '';

        const consumeLine = (rawLine) => {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) return;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') return;

          try {
            const chunk = JSON.parse(jsonStr);
            if (chunk.error) {
              streamError = {
                status: Number(chunk.error.code) || 500,
                message: chunk.error.message || JSON.stringify(chunk.error),
              };
              return;
            }
            if (chunk.promptFeedback?.blockReason) {
              blockReason = String(chunk.promptFeedback.blockReason);
            }
            const candidate = chunk.candidates?.[0];
            if (candidate?.finishReason) {
              lastFinishReason = String(candidate.finishReason);
            }
            const parts = candidate?.content?.parts ?? [];
            for (const p of parts) {
              if (p.thought && p.text) {
                progress.thoughtChars += p.text.length;
              } else if (!p.thought && p.text) {
                progress.outputChars += p.text.length;
              }

              const last = modelParts[modelParts.length - 1];
              const canMergeText =
                last &&
                typeof last.text === 'string' &&
                typeof p.text === 'string' &&
                !last.functionCall &&
                !p.functionCall &&
                !last.thoughtSignature &&
                !p.thoughtSignature &&
                Boolean(last.thought) === Boolean(p.thought);

              if (canMergeText) {
                last.text += p.text;
              } else {
                modelParts.push({ ...p });
              }
            }
          } catch {
            // 忽略非完整 JSON 行
          }
        };

        res.on('data', (chunk) => {
          progress.lastChunkAt = Date.now();
          resetIdleTimer();
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) consumeLine(line);
        });

        res.on('end', () => {
          if (!res.complete) {
            const err = new Error('SSE 連線在完成前被遠端中斷 (premature close)');
            err.name = 'TimeoutError';
            fail(err);
            return;
          }
          const tail = buffer + decoder.decode();
          if (tail.trim()) {
            for (const line of tail.split('\n')) consumeLine(line);
          }
          if (streamError) {
            succeed({
              ok: false,
              status: streamError.status,
              errorText: streamError.message,
            });
            return;
          }
          const hasNonThoughtPart = modelParts.some((p) => !p.thought && (p.text || p.functionCall));
          if (
            !hasNonThoughtPart &&
            (blockReason ||
              ['MALFORMED_FUNCTION_CALL', 'OTHER', 'RECITATION', 'SAFETY'].includes(lastFinishReason))
          ) {
            succeed({
              ok: false,
              status: 502,
              errorText: `模型未產出有效呼叫 (finishReason=${lastFinishReason || blockReason})`,
            });
            return;
          }
          succeed({ ok: true, status, parts: modelParts, finishReason: lastFinishReason });
        });

        res.on('error', fail);
      }
    );

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const err = new Error(`SSE 超過 ${idleTimeoutMs / 1000} 秒無任何新資料 (idle timeout)`);
        err.name = 'TimeoutError';
        req.destroy(err);
        fail(err);
      }, idleTimeoutMs);
    };

    hardTimer = setTimeout(() => {
      const err = new Error(`單步請求超過上限 ${Math.round(hardTimeoutMs / 1000)} 秒 (hard timeout)`);
      err.name = 'TimeoutError';
      req.destroy(err);
      fail(err);
    }, hardTimeoutMs);

    resetIdleTimer();
    req.on('error', fail);
    req.write(bodyStr);
    req.end();
  });
}

// ============================================================================
// 依步驟與任務性質動態選擇適當模型與 Thinking Effort (LOW / MEDIUM / HIGH)
// ============================================================================
function buildGenerationConfigForTask(model, thinkingEffort, options = {}) {
  const isGemini4 = model.startsWith('gemini-4');
  if (isGemini4) {
    return {
      thinkingConfig: {
        thinkingLevel: thinkingEffort,
        includeThoughts: options.includeThoughts ?? true,
      },
      ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
    };
  }
  return {
    temperature: thinkingEffort === 'LOW' ? 0.1 : thinkingEffort === 'MEDIUM' ? 0.2 : 0.3,
    ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
  };
}

function filterAvailableModels(models) {
  const filtered = models.filter((m) => !permanentlyUnavailableModels.has(m));
  return filtered.length > 0 ? filtered : models;
}

/**
 * 根據目前步驟階段、任務複雜度與上一步執行狀態，決定最適合的模型優先序與 Thinking Effort：
 * 1. locate_and_read（首輪定位與讀取階段）：使用 LOW / MEDIUM 思考層級快速搜尋與讀檔
 * 2. verify_and_finish（已通過檢查的收尾摘要階段）：使用 LOW 思考層級在數秒內完成 finish_upgrade
 * 3. error_repair（編譯或沙盒錯誤修復階段）：針對 tsc / UI 沙盒錯誤自動拉升至主力模型 + HIGH 深度除錯
 * 4. implement_change（實作修改階段）：依任務複雜度 (simple / medium / complex) 分配 MEDIUM 或 HIGH
 */
function resolveStepTaskProfile(turn, session, activeModel) {
  // 階段 A：已完成檔案修改且通過 run_checks，只需呼叫 finish_upgrade 提交摘要
  if (session.dirty && session.checksPassed) {
    const models = activeModel
      ? filterAvailableModels(Array.from(new Set([activeModel, ...balancedCandidateModels])))
      : filterAvailableModels(balancedCandidateModels);
    return {
      taskName: 'verify_and_finish',
      taskLabel: '收尾確認',
      thinkingEffort: 'LOW',
      modelsOrder: models,
    };
  }

  // 階段 B：上一輪發生工具或編譯驗證錯誤，需針對性修復
  if (session.lastToolError) {
    if (session.lastToolErrorType === 'patch_mismatch' && session.consecutiveErrors <= 1) {
      const models = activeModel
        ? filterAvailableModels(Array.from(new Set([activeModel, ...deepCandidateModels])))
        : filterAvailableModels(deepCandidateModels);
      return {
        taskName: 'patch_realign',
        taskLabel: '對齊行號重試',
        thinkingEffort: 'MEDIUM',
        modelsOrder: models,
      };
    }
    return {
      taskName: 'error_repair',
      taskLabel: '深度除錯修復',
      thinkingEffort: 'HIGH',
      modelsOrder: filterAvailableModels(deepCandidateModels),
    };
  }

  // 階段 C：剛完成寫檔／改檔，準備執行 run_checks 驗證
  if (session.dirty && !session.checksPassed && session.lastActionWasWrite) {
    const models = activeModel
      ? filterAvailableModels(Array.from(new Set([activeModel, ...deepCandidateModels])))
      : filterAvailableModels(deepCandidateModels);
    return {
      taskName: 'trigger_verification',
      taskLabel: '觸發驗證',
      thinkingEffort: 'LOW',
      modelsOrder: models,
    };
  }

  // 階段 D：首輪探索定位階段（先用 search_in_file / read_file 定位目標區段）
  if (turn === 1 && !session.dirty) {
    const baseModels =
      session.taskComplexity === 'simple' ? balancedCandidateModels : deepCandidateModels;
    return {
      taskName: 'locate_and_read',
      taskLabel: '檔案定位讀取',
      thinkingEffort: 'LOW',
      modelsOrder: filterAvailableModels(baseModels),
    };
  }

  // 階段 E：已搜尋但尚未動筆修改的後續讀取與規劃階段
  if (!session.dirty && session.readCount <= 1) {
    const baseModels =
      session.taskComplexity === 'simple' ? balancedCandidateModels : deepCandidateModels;
    return {
      taskName: 'analyze_context',
      taskLabel: '程式碼分析',
      thinkingEffort: 'MEDIUM',
      modelsOrder: filterAvailableModels(baseModels),
    };
  }

  // 階段 F：核心實作與修改階段（依前置評估之複雜度配置模型與 Thinking Effort）
  if (session.taskComplexity === 'simple') {
    const models = activeModel
      ? filterAvailableModels(Array.from(new Set([activeModel, ...balancedCandidateModels])))
      : filterAvailableModels(balancedCandidateModels);
    return {
      taskName: 'implement_simple',
      taskLabel: '輕量實作修改',
      thinkingEffort: 'MEDIUM',
      modelsOrder: models,
    };
  }

  if (session.taskComplexity === 'medium' && session.modifiedPaths.size <= 1) {
    return {
      taskName: 'implement_medium',
      taskLabel: '標準實作修改',
      thinkingEffort: 'MEDIUM',
      modelsOrder: filterAvailableModels(deepCandidateModels),
    };
  }

  return {
    taskName: 'implement_complex',
    taskLabel: '深度架構實作',
    thinkingEffort: 'HIGH',
    modelsOrder: filterAvailableModels(deepCandidateModels),
  };
}

// 前置安全與複雜度審查（使用輕量模型 + LOW Thinking Effort，及早終止核心禁改請求）
async function runPreflightGate(rawInstruction) {
  const deterministicReject = checkDeterministicForbiddenIntent(rawInstruction);
  if (deterministicReject) {
    return { allowed: false, reason: deterministicReject, complexity: 'simple', modelUsed: 'rule-gate' };
  }

  const gatePrompt = [
    '你是 AI 桌寵自我升級系統的「前置安全與複雜度審查員」。',
    '請判斷主人的升級指令是否允許執行，並評估任務複雜度，嚴格輸出 JSON：',
    '{"allowed":true|false,"reason":"繁體中文簡短原因","complexity":"simple|medium|complex"}',
    '',
    '【必須判定 allowed: false 的情況（核心禁改提早終止）】',
    `1. 要求刪除或破壞核心保留工具（${PROTECTED_CORE_TOOLS.join(', ')}）或受保護必要檔案（${PROTECTED_FILES.join(', ')}）。`,
    `2. 需求「必須」修改唯讀核心檔案（${READ_ONLY_CORE_FILES.join(', ')}）或系統工作流（${FORBIDDEN_SYSTEM_PATHS.join(', ')}）或安裝新 npm 套件才能達成，無法僅靠新增/修改 src/plugins/*.ts、src/ui.ts、src/ui/** 完成。`,
    '',
    '【必須判定 allowed: true 的情況】',
    '- 新增或修改後端自訂插件（src/plugins/*.ts 與 src/plugins/registry.ts）、調整生理時鐘規則（src/plugins/lifecycle.ts）、微調貼圖設定（src/plugins/stickers.ts）、或修改前端 UI 介面與互動（src/ui.ts、src/ui/**）。',
    '- 若指令只是提到參考某個唯讀檔案（如參考 src/types.ts），但實際修改範圍在 src/plugins/ 或 src/ui/，屬於允許範圍。',
    '',
    '【complexity 分級標準】',
    '- simple：單純修改文案、顏色、樣式、貼圖提示詞、數值微調或單一檔案小改動。',
    '- medium：一般 UI 元件調整、單一插件功能增改、生理時鐘規則調整。',
    '- complex：新增完整插件並串接 UI、跨多個 UI 子模組重構、複雜互動邏輯。',
  ].join('\n');

  const models = filterAvailableModels(fastGateCandidateModels);
  for (const model of models) {
    const progress = {
      thoughtChars: 0,
      outputChars: 0,
      startedAt: Date.now(),
      lastChunkAt: Date.now(),
    };
    try {
      const res = await streamVertexWithWatchdog(
        buildStreamEndpoint(model),
        {
          systemInstruction: { parts: [{ text: gatePrompt }] },
          contents: [{ role: 'user', parts: [{ text: `主人升級指令：\n${rawInstruction}` }] }],
          generationConfig: buildGenerationConfigForTask(model, 'LOW', {
            includeThoughts: false,
            responseMimeType: 'application/json',
          }),
        },
        progress,
        { idleTimeoutMs: PREFLIGHT_TIMEOUT_MS, hardTimeoutMs: PREFLIGHT_TIMEOUT_MS }
      );

      if (!res.ok) {
        if (res.status === 403 || res.status === 404) {
          permanentlyUnavailableModels.add(model);
        }
        continue;
      }

      const rawText = (res.parts || [])
        .filter((p) => !p.thought && p.text)
        .map((p) => p.text)
        .join('')
        .trim();
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]);
      const complexity =
        parsed.complexity === 'simple' || parsed.complexity === 'medium' || parsed.complexity === 'complex'
          ? parsed.complexity
          : 'medium';
      return {
        allowed: parsed.allowed !== false,
        reason: String(parsed.reason || '').trim(),
        complexity,
        modelUsed: model,
      };
    } catch {
      // 前置審查若遇網路異常，安全回退交由主迴圈處理
    }
  }

  return { allowed: true, reason: '預設放行', complexity: 'medium', modelUsed: 'fallback' };
}

// 切換不同模型時清除前一個模型產生的 thought 與 thoughtSignature，避免跨模型 400 錯誤
function sanitizeContentsForFallback(contents) {
  return contents.map((turn) => {
    if (turn.role !== 'model') return turn;
    const cleaned = turn.parts
      .filter((p) => !p.thought)
      .map((p) => {
        const copy = { ...p };
        delete copy.thoughtSignature;
        return copy;
      });
    return {
      role: 'model',
      parts: cleaned.length > 0 ? cleaned : [{ text: '...' }],
    };
  });
}

// 非破壞性壓縮送出給模型的歷史上下文：保留最近 N 輪完整 functionResponse，摺疊更早輪次的長輸出
function pruneContentsForRequest(contents, keepRecentToolTurns = KEEP_RECENT_TOOL_TURNS) {
  const toolTurnIndices = [];
  for (let i = 0; i < contents.length; i += 1) {
    const turn = contents[i];
    if (
      turn.role === 'user' &&
      Array.isArray(turn.parts) &&
      turn.parts.some((p) => p.functionResponse)
    ) {
      toolTurnIndices.push(i);
    }
  }
  if (toolTurnIndices.length <= keepRecentToolTurns) {
    return contents;
  }

  const pruneIndexSet = new Set(
    toolTurnIndices.slice(0, toolTurnIndices.length - keepRecentToolTurns)
  );
  return contents.map((turn, idx) => {
    if (!pruneIndexSet.has(idx)) return turn;
    return {
      ...turn,
      parts: turn.parts.map((part) => {
        const fr = part.functionResponse;
        if (!fr || !PRUNABLE_TOOLS.has(fr.name)) return part;
        const resp = fr.response && typeof fr.response === 'object' ? fr.response : {};
        return {
          ...part,
          functionResponse: {
            ...fr,
            response: {
              ok: resp.ok ?? true,
              ...(resp.path ? { path: resp.path } : {}),
              ...(resp.range ? { range: resp.range } : {}),
              ...(typeof resp.passed === 'boolean' ? { passed: resp.passed } : {}),
              pruned: true,
              summary: `[已摺疊舊輪次 ${fr.name} 輸出以節省 Token，如需內容請重新呼叫 ${fr.name}]`,
            },
          },
        };
      }),
    };
  });
}

async function callAgentStep(stepProfile, lastModelUsed, systemPrompt, contents, turnNum) {
  const { modelsOrder, thinkingEffort, taskLabel } = stepProfile;
  const errors = [];

  modelLoop: for (const model of modelsOrder) {
    const generationConfig = buildGenerationConfigForTask(model, thinkingEffort, {
      includeThoughts: true,
    });
    const effortTag = model.startsWith('gemini-4') ? `｜Think:${thinkingEffort}` : '';

    const effectiveContents =
      lastModelUsed && model !== lastModelUsed ? sanitizeContentsForFallback(contents) : contents;

    for (let retry = 0; retry <= MAX_STEP_RETRIES; retry += 1) {
      const retryTag = retry > 0 ? `（重試 ${retry}/${MAX_STEP_RETRIES}）` : '';
      const progress = {
        thoughtChars: 0,
        outputChars: 0,
        startedAt: Date.now(),
        lastChunkAt: Date.now(),
      };

      const heartbeatTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - progress.startedAt) / 1000);
        const idleSec = Math.floor((Date.now() - progress.lastChunkAt) / 1000);
        void updateHeartbeat(
          `[步驟 ${turnNum}/${MAX_AGENT_TURNS}·${taskLabel}] ${model}${effortTag}${retryTag} 思考中（${sec}s｜靜止 ${idleSec}s｜思考 ${progress.thoughtChars} 字）`
        );
      }, HEARTBEAT_INTERVAL_MS);

      try {
        const result = await streamVertexWithWatchdog(
          buildStreamEndpoint(model),
          {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: effectiveContents,
            tools: [{ functionDeclarations: AGENT_TOOL_DECLARATIONS }],
            generationConfig,
          },
          progress
        );

        if (result.ok) {
          return {
            parts: result.parts || [],
            modelUsed: model,
            thinkingEffort,
            taskLabel,
          };
        }

        const errText = result.errorText || '';
        errors.push(`[${model}${effortTag}${retryTag} -> ${result.status}] ${errText.slice(0, 160)}`);

        if (result.status === 403 || result.status === 404) {
          permanentlyUnavailableModels.add(model);
        }

        if (isRetryableHttpStatus(result.status) && retry < MAX_STEP_RETRIES) {
          const waitMs = computeRetryDelayMs(retry, result.status);
          await logStep(
            'model_retry',
            `${model} 回傳 ${result.status}，${(waitMs / 1000).toFixed(1)} 秒後退避重試 (${retry + 1}/${MAX_STEP_RETRIES})...`
          );
          await sleep(waitMs);
          continue;
        }

        await logStep('model_fallback', `${model} 回傳 ${result.status}，切換備援模型`);
        if (![403, 404, 408, 429, 500, 502, 503, 504].includes(result.status)) {
          break modelLoop;
        }
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${model}${effortTag}${retryTag} 異常] ${msg}`);

        if (isTimeoutError(err) && retry < MAX_STEP_RETRIES) {
          const waitMs = computeRetryDelayMs(retry, 408);
          await logStep(
            'model_retry',
            `${model} 發生逾時 (${msg.slice(0, 60)})，${(waitMs / 1000).toFixed(1)} 秒後退避重試 (${retry + 1}/${MAX_STEP_RETRIES})...`
          );
          await sleep(waitMs);
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

// ============================================================================
// 主工作流：前置安全審查 -> 依步驟動態模型/Thinking 調度 -> 驗證修復 -> PR 與自動合併
// ============================================================================
function buildSystemPrompt() {
  return [
    '你是這隻 TypeScript Cloudflare Workers AI 桌寵的「自主升級工程師 Agent」。',
    '你可以透過工具分步驟閱讀程式碼、修改或新增檔案、執行編譯與沙盒驗證，直到完全無誤後呼叫 finish_upgrade。',
    '',
    '【最高安全與核心保護規則（涉及禁改檔案必須立即終止）】',
    `1. 絕對不可損害或刪除核心功能（核心工具包含：${PROTECTED_CORE_TOOLS.join(', ')}，以及對話記憶、路由、自我升級本身）。`,
    `2. 可編輯路徑僅限：src/plugins/[a-z][a-z0-9-]*.ts、src/ui.ts、src/ui/[a-z][a-z0-9-]*(/[a-z][a-z0-9-]*)?.(ts|html|css|js)。嚴禁刪除以下必要核心檔案：${PROTECTED_FILES.join('、')}。`,
    `3. 唯讀核心參考檔案（${READ_ONLY_CORE_FILES.join('、')}）僅供閱讀對齊 API 與型別，嚴禁修改；系統腳本與工作流（${FORBIDDEN_SYSTEM_PATHS.join('、')}）亦嚴禁修改。`,
    '4. 若主人的需求會刪除或破壞核心功能，或「必須修改唯讀核心檔案／安裝外部 npm 套件／修改系統工作流」才能達成，請在第一時間直接呼叫 reject_upgrade 說明原因，嚴禁在 UI 或插件中撰寫假功能或殘缺繞道實作。',
    '5. 新增或刪除插件時，必須同步更新 src/plugins/registry.ts，確保所有 import 與 CUSTOM_PLUGINS 陣列一致。',
    '6. 後端僅能使用標準 Web API（fetch、URL、Intl、crypto）與純 TypeScript strict mode（無 any、無未使用變數、不新增外部 npm 套件）。',
    '7. UI 介面規範：',
    '   - src/ui.ts 必須匯出完整 HTML 字串 `export const CHAT_HTML: string`。',
    '   - 目前 src/ui/ 已按功能垂直拆分為獨立子資料夾（`src/ui/core/`、`src/ui/upgrade/`、`src/ui/proactive/`、`src/ui/care-game/`、`src/ui/diary-persona/`），每個資料夾內各自包含原生 `.html`、`.css`、`script.js` 與組裝用的 `service.ts`，並由 `src/ui/ui-events.ts` 定義跨模組 CustomEvent 事件契約；修改單一功能 UI 時，只需定位並修改對應資料夾內的檔案，無需讀取無關模組。',
    '   - 組裝後的 HTML 必須保留 `/v1/pet/interact`、`/v1/pet/upgrade/status`、Token 設定彈窗、localStorage (`pet_bff_token`, `pet_user_id`) 與核心 DOM 元素 (`#chat`, `#msgInput`, `#sendBtn`, `#upgradeBtn`)。',
    '   - 前端腳本已獨立於各子資料夾的 `script.js` 中，可直接撰寫原生前端 JS，無需使用模板字串反引號跳脫。',
    '8. src/plugins/lifecycle.ts 為每小時 Cron 生理時鐘規則檔，嚴禁刪除且必須保留 export function computeNextLifecycleState(state: PetState, ctx: LifecycleContext): PetState。',
    '9. 後端已提供以下受 Bearer Token 保護嘅唯讀／互動 API，修改前端 UI 時可直接呼叫：GET /v1/pet/state?uid=...、GET /v1/pet/diaries?uid=...&limit=30、GET /v1/pet/persona?uid=...、POST /v1/pet/persona/rollback?uid=...、POST /v1/pet/dream/trigger?uid=...&force=true。',
    '10. src/plugins/stickers.ts 為貼圖註冊表，嚴禁刪除且必須保留 STICKER_PACK 與相關匯出函式；不可修改或刪除 public/stickers/ 內圖片，但可依主人需求微調 bot_hint、meaning、category 或 enabled。',
    '',
    '【高效多步工作流】',
    '1. 首輪訊息已附上完整專案檔案清單，請直接針對需求相關檔案呼叫 search_in_file 或 read_file（可於同一輪並行呼叫多個讀取／搜尋工具）。',
    '2. 面對超過 250 行的檔案，先用 search_in_file 搜尋關鍵字定位行號，再用 read_file 指定 start_line / end_line 局部讀取目標區段，接著以 patch_file 精準修改。',
    '3. 小範圍修改優先使用 patch_file；新增檔案或大重構使用 write_file。',
    '4. 完成所有檔案變更後，必須呼叫 run_checks 驗證安全性、插件註冊、UI 沙盒、TypeScript 編譯與 Wrangler 打包；若報錯請立即針對錯誤行數修復並重跑 run_checks。',
    '5. 確認 run_checks 全數通過後，立即呼叫 finish_upgrade 結束任務並提供簡短繁體中文 summary。',
  ].join('\n');
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

let createdPrUrl = '';
let createdBranchName = '';

async function main() {
  await initRecordFromRedis();
  await logStep('actions_started', 'GitHub Actions Agentic 升級引擎已啟動...');

  if (!apiKey || !projectId || !instruction) {
    throw new Error('缺少必要參數（GOOGLE_CLOUD_API_KEY / GCP_PROJECT_ID / instruction）');
  }

  // 步驟 0：以輕量模型 + LOW Thinking Effort 執行前置安全與範圍審查，若涉及核心禁改檔案立即終止
  await logStep('preflight_check', '執行前置安全邊界與任務複雜度審查 (Thinking: LOW)...');
  const preflight = await runPreflightGate(instruction);
  if (!preflight.allowed) {
    record.status = 'rejected';
    record.error = preflight.reason || '升級需求涉及受保護核心檔案或超出允許範圍，已提前終止';
    await logStep('rejected', `安全攔截（前置早停）：${record.error}`);
    return;
  }
  await logStep(
    'preflight_passed',
    `前置審查通過（複雜度：${preflight.complexity}｜審查引擎：${preflight.modelUsed}）`
  );

  const initialFiles = listProjectFiles();
  const systemPrompt = buildSystemPrompt();
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: [
            '【專案完整檔案清單（已全部列出，無需再查詢目錄）】',
            `- 可編輯檔案：${initialFiles.editable_files.join(', ')}`,
            `- 唯讀核心參考檔案（不可修改）：${initialFiles.read_only_reference_files.join(', ')}`,
            '',
            `【主人的升級需求】\n${instruction}`,
            '',
            '請開始按步驟讀取必要檔案、規劃並實作修改；若讀取後發現必須修改唯讀核心檔案才能達成，請立即呼叫 reject_upgrade 終止；完成修改並通過 run_checks 後呼叫 finish_upgrade。',
          ].join('\n'),
        },
      ],
    },
  ];

  const session = {
    dirty: false,
    uiTouched: false,
    checksPassed: false,
    lastActionWasWrite: false,
    readCount: 0,
    searchCount: 0,
    forbiddenAttempts: 0,
    consecutiveErrors: 0,
    lastToolError: null,
    lastToolErrorType: null,
    taskComplexity: preflight.complexity || 'medium',
    touchedFiles: new Set(),
    modifiedPaths: new Set(),
    outcome: null,
  };

  let lastModelUsed = null;
  let turnsUsed = 0;
  let emptyNudges = 0;

  for (let turn = 1; turn <= MAX_AGENT_TURNS; turn += 1) {
    turnsUsed = turn;
    const stepProfile = resolveStepTaskProfile(turn, session, lastModelUsed);

    const requestContents = pruneContentsForRequest(contents, KEEP_RECENT_TOOL_TURNS);
    const { parts, modelUsed } = await callAgentStep(
      stepProfile,
      lastModelUsed,
      systemPrompt,
      requestContents,
      turn
    );

    // 若本輪切換了不同模型，同步清洗歷史簽名以確保後續輪次相容
    if (lastModelUsed && modelUsed !== lastModelUsed) {
      const cleaned = sanitizeContentsForFallback(contents);
      contents.length = 0;
      contents.push(...cleaned);
    }
    lastModelUsed = modelUsed;

    // 確保推入 contents 的 model parts 絕不為空陣列，避免下一輪觸發 Vertex API 400
    const safeModelParts = parts.length > 0 ? parts : [{ text: '...' }];
    contents.push({ role: 'model', parts: safeModelParts });

    const functionCalls = safeModelParts.filter((p) => p.functionCall);

    if (functionCalls.length === 0) {
      emptyNudges += 1;
      if (emptyNudges > 2) {
        throw new Error('Agent 連續回覆純文字且未呼叫 finish_upgrade 或 reject_upgrade');
      }
      contents.push({
        role: 'user',
        parts: [
          {
            text: '請使用工具完成操作：若已完成所有修改請呼叫 run_checks 並呼叫 finish_upgrade；若涉及核心禁改檔案請呼叫 reject_upgrade。',
          },
        ],
      });
      continue;
    }

    // 成功呼叫工具後重置 emptyNudges 計數器
    emptyNudges = 0;
    session.lastActionWasWrite = functionCalls.some((fc) =>
      ['write_file', 'patch_file', 'delete_file'].includes(fc.functionCall?.name)
    );

    const responseParts = await executeTurnFunctionCalls(functionCalls, session);
    if (!session.outcome && MAX_AGENT_TURNS - turn <= 3) {
      responseParts.push({
        text: `⚠️ 系統提醒：目前剩餘自主步驟僅剩 ${MAX_AGENT_TURNS - turn} 步，請停止探索性讀取，盡快完成必要修改、呼叫 run_checks 並呼叫 finish_upgrade。`,
      });
    }
    contents.push({ role: 'user', parts: responseParts });

    if (session.outcome) break;
  }

  // 若達步數上限時已有修改但尚未執行最後一次 run_checks，嘗試自動驗證搶救；若通過則直接收尾
  if (!session.outcome && session.dirty && !session.checksPassed) {
    try {
      await logStep('type_checking', '已達步驟上限，自動執行最終檢查以確認是否可安全提交...');
      runAllChecks(session);
      session.checksPassed = true;
    } catch {
      // 最終檢查未通過則照原流程還原並回報失敗
    }
  }

  // 若剛好在最後一輪通過所有檢查但尚未呼叫 finish_upgrade，自動完成收尾而不丟棄成果
  if (!session.outcome && session.dirty && session.checksPassed) {
    const changed = getGitChangedFiles();
    if (changed.length > 0) {
      session.outcome = {
        type: 'finish',
        summary: instruction.replace(/\s+/g, ' ').slice(0, 28) || '完成自主升級修改',
      };
    }
  }

  if (!session.outcome) {
    resetWorkspace();
    throw new Error(`已達最大自主步驟上限 (${MAX_AGENT_TURNS} 步) 仍未完成升級，工作區已還原`);
  }

  if (session.outcome.type === 'reject') {
    resetWorkspace();
    record.status = 'rejected';
    record.error = session.outcome.reason;
    await logStep('rejected', `安全攔截：${session.outcome.reason}`);
    return;
  }

  // 建立升級分支、提交、開 PR 並自動合併（具備網路重試與孤兒 PR 清理保護）
  const summary = session.outcome.summary;
  const changedList = getGitChangedFiles();
  const branchName = `self-upgrade/${Date.now()}`;
  createdBranchName = branchName;

  execFileSync('git', ['config', 'user.name', 'Gemini Pet Bot']);
  execFileSync('git', ['config', 'user.email', 'gemini-pet-bot@users.noreply.github.com']);
  execFileSync('git', ['checkout', '-b', branchName]);
  stageAllowedPaths();
  execFileSync('git', ['commit', '-m', `feat(self-upgrade): ${summary}`]);

  await logStep('pushing_pr', `正在推送分支 ${branchName} 並建立 Pull Request...`);
  execWithRetry('git', ['push', 'origin', branchName], { encoding: 'utf8' }, 2);

  const prBody = [
    `由 **${lastModelUsed}** 透過多步 Agentic 引擎（共 ${turnsUsed} 步，複雜度：\`${session.taskComplexity}\`）完成，已通過安全掃描、插件註冊、UI 沙盒、\`tsc --noEmit\` 與 \`wrangler deploy --dry-run\` 檢查。`,
    '',
    '### 變更檔案',
    ...changedList.map((item) => `- \`${item}\``),
  ].join('\n');

  const prUrl = execWithRetry(
    'gh',
    [
      'pr',
      'create',
      '--title',
      `🤖 桌寵自我升級：${summary}`,
      '--body',
      prBody,
      '--base',
      baseBranch,
      '--head',
      branchName,
    ],
    { encoding: 'utf8' },
    2
  ).trim();

  createdPrUrl = prUrl;
  record.status = 'pr_created';
  record.pr_url = prUrl;
  record.summary = `[${lastModelUsed} · ${turnsUsed}步] ${summary}`;
  record.changed_files = changedList;
  await logStep('pr_created', 'PR 已建立，正在自動合併至主分支...');

  execWithRetry('gh', ['pr', 'merge', prUrl, '--squash', '--delete-branch'], { encoding: 'utf8' }, 2);

  record.status = 'merged';
  await logStep(
    'merged',
    `升級已自動合併至 main（共 ${turnsUsed} 步）！Cloudflare 約 30 秒後完成部署，重新整理頁面即可生效。`
  );
}

main().catch(async (err) => {
  if (createdPrUrl) {
    try {
      execFileSync('gh', ['pr', 'close', createdPrUrl, '--delete-branch'], { stdio: 'pipe' });
    } catch {
      // 忽略孤兒 PR 清理失敗
    }
  } else if (createdBranchName) {
    try {
      execFileSync('git', ['push', 'origin', '--delete', createdBranchName], { stdio: 'pipe' });
    } catch {
      // 忽略遠端分支清理失敗
    }
  }
  try {
    resetWorkspace();
  } catch {
    // 忽略本地清理異常
  }
  record.status = 'failed';
  record.error = err instanceof Error ? err.message : String(err);
  await logStep('failed', `任務失敗：${record.error}`);
  process.exit(1);
});
