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
];

const READ_ONLY_CORE_FILES = [
  'src/types.ts',
  'src/index.ts',
  'src/tools.ts',
  'src/services.ts',
  'package.json',
  'tsconfig.json',
  'wrangler.toml',
];

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 超過 5 分鐘完全無新 chunk 先判逾時
const HARD_TIMEOUT_MS = 20 * 60 * 1000; // 單一思考步驟總上限 20 分鐘
const HEARTBEAT_INTERVAL_MS = 20 * 1000; // 每 20 秒回寫一次心跳給 PWA
const MAX_AGENT_TURNS = 20; // 最多執行 20 輪自主讀寫與修復步驟
const MAX_TIMEOUT_RETRIES = 1; // 同一模型逾時後先原地重試 1 次
const TIMEOUT_RETRY_DELAY_MS = 5 * 1000;
const DEFAULT_MAX_READ_LINES = 150;
const MAX_SEARCH_MATCHES = 30;
const KEEP_RECENT_TOOL_TURNS = 3;
const PRUNABLE_TOOLS = new Set(['read_file', 'search_in_file', 'run_checks']);

const userId = (process.env.INPUT_USER_ID || 'zero_main').trim();
const instruction = (process.env.INPUT_INSTRUCTION || '').trim();
const apiKey = (process.env.GOOGLE_CLOUD_API_KEY || '').trim();
const projectId = (process.env.INPUT_GCP_PROJECT_ID || '').trim();
const location = (process.env.INPUT_GCP_LOCATION || 'global').trim();
const primaryModel = (process.env.INPUT_MODEL_UPGRADER || 'gemini-4-argon').trim();
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTimeoutError(err) {
  const name = err?.name || '';
  const msg = err instanceof Error ? err.message : String(err);
  const causeCode = err?.cause?.code || err?.code || '';
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET'].includes(causeCode) ||
    /timeout|timed out|aborted|premature close/i.test(msg)
  );
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
    // 忽略讀取異常
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
  record.step = 'agent_thinking';
  if (record.logs.length > 0 && record.logs[record.logs.length - 1].includes('💓')) {
    record.logs[record.logs.length - 1] = line;
  } else {
    record.logs = [...record.logs, line].slice(-25);
  }
  record.updated_at = new Date().toISOString();
  await redisCmd(['SET', `upgrade:${userId}`, JSON.stringify(record)]);
}

// ============================================================================
// 路徑白名單與安全驗證層
// ============================================================================
function normalizeRelPath(inputPath) {
  if (typeof inputPath !== 'string') return '';
  return inputPath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function isEditablePath(relPath) {
  if (relPath === 'src/ui.ts') return true;
  if (/^src\/ui\/[a-z][a-z0-9-]*\.ts$/.test(relPath)) return true;
  if (/^src\/plugins\/[a-z][a-z0-9-]*\.ts$/.test(relPath)) return true;
  return false;
}

function isReadablePath(relPath) {
  return isEditablePath(relPath) || READ_ONLY_CORE_FILES.includes(relPath);
}

function isUiPath(relPath) {
  return relPath === 'src/ui.ts' || relPath.startsWith('src/ui/');
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
  if (fs.existsSync(uiDir) && fs.statSync(uiDir).isDirectory()) {
    for (const name of fs.readdirSync(uiDir).sort()) {
      if (name.endsWith('.ts')) editable.push(`src/ui/${name}`);
    }
  }

  const readOnly = READ_ONLY_CORE_FILES.filter((p) => fs.existsSync(path.resolve(p)));
  return { editable_files: editable, read_only_reference_files: readOnly };
}

function validateFileSecurity(relPath, content) {
  if (/\b(eval|new Function)\b/.test(content)) {
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

  const requiredTokens = ['/v1/pet/interact', '/v1/pet/upgrade/status', 'pet_bff_token'];
  for (const token of requiredTokens) {
    if (!html.includes(token)) {
      throw new Error(
        `安全攔截：組裝後的 CHAT_HTML 缺少必要核心連線標記 (${token})，已中止以避免頁面失效`
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
  const out = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim();
      const file = line.slice(2).trim().replace(/^"|"$/g, '');
      return `${status}:${file}`;
    });
}

function runAllChecks(uiTouched) {
  // 1. 掃描所有可編輯檔案安全性
  const { editable_files } = listProjectFiles();
  if (!editable_files.includes('src/plugins/registry.ts')) {
    throw new Error('安全攔截：缺少必要檔案 src/plugins/registry.ts');
  } 
  if (!editable_files.includes('src/plugins/stickers.ts')) {
    throw new Error('安全攔截：缺少必要檔案 src/plugins/stickers.ts');
  }
  for (const relPath of editable_files) {
    const content = fs.readFileSync(path.resolve(relPath), 'utf8');
    validateFileSecurity(relPath, content);
  }

  // 2. 若改動過 UI，執行跨檔組裝、契約與內嵌 JS 驗證
  if (uiTouched) {
    validateWorkspaceUi();
  }

  // 3. 執行全專案 TypeScript strict mode 檢查
  try {
    execFileSync('npx', ['tsc', '--noEmit'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`.trim().slice(0, 2500);
    throw new Error(`TypeScript (tsc --noEmit) 編譯失敗：\n${output}`);
  }

  const changedFiles = getGitChangedFiles();
  return { changedFiles };
}

function resetWorkspace() {
  execFileSync('git', ['reset', '--hard', 'HEAD'], { stdio: 'pipe' });
  execFileSync('git', ['clean', '-fd', '--', 'src/plugins', 'src/ui'], { stdio: 'pipe' });
}

// ============================================================================
// Vertex AI Agent 工具定義與執行器
// ============================================================================
const AGENT_TOOL_DECLARATIONS = [
  {
    name: 'list_files',
    description: '列出所有可編輯檔案（src/plugins/*、src/ui.ts、src/ui/*）與唯讀核心參考檔案清單。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'read_file',
    description:
      '讀取檔案內容（會附帶行號）。若未指定 start_line / end_line 且超過 150 行，預設僅回傳前 150 行；大型檔案請先用 search_in_file 定位再指定行號分段讀取。',
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
        path: { type: 'STRING', description: '專案相對路徑，例如 src/ui/script.ts' },
        query: { type: 'STRING', description: '搜尋關鍵字或正規表達式字串' },
        is_regex: { type: 'BOOLEAN', description: '是否將 query 視為正規表達式（預設 false）' },
        case_sensitive: { type: 'BOOLEAN', description: '是否區分大小寫（預設 false）' },
      },
      required: ['path', 'query'],
    },
  },
  {
    name: 'write_file',
    description: '新增或整檔覆寫白名單內的可編輯檔案（src/plugins/*.ts、src/ui.ts、src/ui/*.ts）。適合新增檔案或大型重構。',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: '目標檔案路徑（必須在白名單內）' },
        content: { type: 'STRING', description: '完整的檔案程式碼內容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'patch_file',
    description: '對既有白名單檔案執行精準單點替換。對小範圍修改優先使用此工具，每個 search 必須在目標檔案中剛好出現一次。',
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
    description: '刪除不再需要的自訂插件或 UI 子模組（禁止刪除 src/ui.ts 與 src/plugins/registry.ts）。',
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
    description: '立即執行安全掃描、UI 跨檔沙盒與 <script> 語法驗證、以及 npx tsc --noEmit 全專案型別檢查。如有錯誤會回傳具體行號供你修正。',
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
    description: '當主人的需求會刪除或損害核心功能、或超出允許範圍時呼叫此工具安全拒絕。',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: '繁體中文說明拒絕原因' },
      },
      required: ['reason'],
    },
  },
];

async function executeTool(name, args, session) {
  try {
    if (name === 'list_files') {
      await logStep('tool_list', '檢視專案檔案結構...');
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

      await logStep(
        'tool_read',
        `讀取 ${relPath}（第 ${start}-${end} 行 / 共 ${totalLines} 行${truncated ? '，已截斷' : ''}）`
      );
      return {
        ok: true,
        path: relPath,
        editable: isEditablePath(relPath),
        total_lines: totalLines,
        range: `${start}-${end}`,
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

      await logStep(
        'tool_search',
        `搜尋 ${relPath}（「${query.slice(0, 30)}」，命中 ${totalMatches} 筆）`
      );
      return {
        ok: true,
        path: relPath,
        total_lines: lines.length,
        total_matches: totalMatches,
        truncated: totalMatches > MAX_SEARCH_MATCHES,
        matches,
      };
    }

    if (name === 'write_file') {
      const relPath = normalizeRelPath(args.path);
      if (!isEditablePath(relPath)) {
        return { ok: false, error: `安全攔截：禁止寫入核心或未授權路徑 (${relPath})` };
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
      if (isUiPath(relPath)) session.uiTouched = true;
      session.touchedFiles.add(`upsert:${relPath}`);

      await logStep('tool_write', `寫入檔案 ${relPath}（${content.split('\n').length} 行）`);
      return { ok: true, path: relPath, lines: content.split('\n').length };
    }

    if (name === 'patch_file') {
      const relPath = normalizeRelPath(args.path);
      if (!isEditablePath(relPath)) {
        return { ok: false, error: `安全攔截：禁止修改核心或未授權路徑 (${relPath})` };
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
          return {
            ok: false,
            error: `第 ${i + 1} 段 patch 在 ${relPath} 中找不到 search 原文，請先 read_file 確認精準縮排或改用 write_file`,
          };
        }
        const secondIdx = content.indexOf(p.search, firstIdx + 1);
        if (secondIdx !== -1) {
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
      if (isUiPath(relPath)) session.uiTouched = true;
      session.touchedFiles.add(`patch:${relPath}`);

      await logStep('tool_patch', `局部更新 ${relPath}（套用 ${patches.length} 處 patch）`);
      return { ok: true, path: relPath, patches_applied: patches.length };
    }

    if (name === 'delete_file') {
      const relPath = normalizeRelPath(args.path);
      if (!isEditablePath(relPath)) {
        return { ok: false, error: `安全攔截：禁止刪除核心或未授權路徑 (${relPath})` };
      }
      if (relPath === 'src/ui.ts' || relPath === 'src/plugins/registry.ts') {
        return { ok: false, error: `安全攔截：禁止刪除必要檔案 (${relPath})` };
      }
      const absPath = path.resolve(relPath);
      if (!fs.existsSync(absPath)) {
        return { ok: false, error: `檔案原本就不存在：${relPath}` };
      }
      if (
        relPath === 'src/ui.ts' ||
        relPath === 'src/plugins/registry.ts' ||
        relPath === 'src/plugins/lifecycle.ts' ||
        relPath === 'src/plugins/stickers.ts'
      ) {
        return { ok: false, error: `安全攔截：禁止刪除必要檔案 (${relPath})` };
      }
      fs.unlinkSync(absPath);

      session.dirty = true;
      session.checksPassed = false;
      if (isUiPath(relPath)) session.uiTouched = true;
      session.touchedFiles.add(`delete:${relPath}`);

      await logStep('tool_delete', `刪除檔案 ${relPath}`);
      return { ok: true, deleted: relPath };
    }

    if (name === 'run_checks') {
      await logStep('type_checking', '執行安全掃描、UI 沙盒與 npx tsc --noEmit 檢查...');
      const { changedFiles } = runAllChecks(session.uiTouched);
      session.checksPassed = true;
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
        await logStep('type_checking', '結束前自動執行最終安全與型別檢查...');
        const { changedFiles } = runAllChecks(session.uiTouched);
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
      const reason = String(args.reason || '此操作可能影響核心功能，已拒絕執行').trim();
      session.outcome = { type: 'reject', reason };
      return { ok: true, status: 'rejected', reason };
    }

    return { ok: false, error: `未知工具：${name}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logStep('tool_error', `${name} 回報錯誤，交由 Agent 修正：${msg.split('\n')[0].slice(0, 100)}`);
    return { ok: false, error: msg };
  }
}

// ============================================================================
// Vertex AI node:https SSE 串流引擎（Idle Watchdog + 完整保留 thoughtSignature）
// ============================================================================
function buildStreamEndpoint(model) {
  const host =
    location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
}

function streamVertexWithWatchdog(urlStr, payload, progress) {
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
          succeed({ ok: true, status, parts: modelParts });
        });

        res.on('error', fail);
      }
    );

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const err = new Error(`SSE 超過 ${IDLE_TIMEOUT_MS / 1000} 秒無任何新資料 (idle timeout)`);
        err.name = 'TimeoutError';
        req.destroy(err);
        fail(err);
      }, IDLE_TIMEOUT_MS);
    };

    hardTimer = setTimeout(() => {
      const err = new Error(`單步請求超過上限 ${HARD_TIMEOUT_MS / 60000} 分鐘 (hard timeout)`);
      err.name = 'TimeoutError';
      req.destroy(err);
      fail(err);
    }, HARD_TIMEOUT_MS);

    resetIdleTimer();
    req.on('error', fail);
    req.write(bodyStr);
    req.end();
  });
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

async function callAgentStep(modelsOrder, lastModelUsed, systemPrompt, contents, turnNum) {
  const errors = [];

  modelLoop: for (const model of modelsOrder) {
    const generationConfig = model.startsWith('gemini-4')
      ? { thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: true } }
      : { temperature: 0.2 };

    const effectiveContents =
      lastModelUsed && model !== lastModelUsed ? sanitizeContentsForFallback(contents) : contents;

    for (let retry = 0; retry <= MAX_TIMEOUT_RETRIES; retry += 1) {
      const retryTag = retry > 0 ? `（逾時重試 ${retry}/${MAX_TIMEOUT_RETRIES}）` : '';
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
          `[步驟 ${turnNum}/${MAX_AGENT_TURNS}] ${model}${retryTag} 思考中（${sec}s｜靜止 ${idleSec}s｜思考 ${progress.thoughtChars} 字）`
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
          return { parts: result.parts || [], modelUsed: model };
        }

        const errText = result.errorText || '';
        errors.push(`[${model}${retryTag} -> ${result.status}] ${errText.slice(0, 160)}`);

        if ((result.status === 408 || result.status === 504) && retry < MAX_TIMEOUT_RETRIES) {
          await logStep(
            'model_timeout_retry',
            `${model} 伺服端逾時 (${result.status})，${TIMEOUT_RETRY_DELAY_MS / 1000} 秒後重試...`
          );
          await sleep(TIMEOUT_RETRY_DELAY_MS);
          continue;
        }

        await logStep('model_fallback', `${model} 回傳 ${result.status}，切換備援模型`);
        if (![403, 404, 408, 429, 500, 502, 503, 504].includes(result.status)) {
          break modelLoop;
        }
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${model}${retryTag} 異常] ${msg}`);

        if (isTimeoutError(err) && retry < MAX_TIMEOUT_RETRIES) {
          await logStep(
            'model_timeout_retry',
            `${model} 發生逾時 (${msg.slice(0, 60)})，${TIMEOUT_RETRY_DELAY_MS / 1000} 秒後重試...`
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

// ============================================================================
// 主工作流：自主規劃 -> 讀寫修改 -> 驗證修復 -> PR 與自動合併
// ============================================================================
function buildSystemPrompt() {
  return [
    '你是這隻 TypeScript Cloudflare Workers AI 桌寵的「自主升級工程師 Agent」。',
    '你可以透過工具分步驟檢視專案、閱讀程式碼、修改或新增檔案、執行編譯與沙盒驗證，直到完全無誤後呼叫 finish_upgrade。',
    '',
    '【最高安全與核心保護規則】',
    `1. 絕對不可損害或刪除核心功能（核心工具包含：${PROTECTED_CORE_TOOLS.join(', ')}，以及對話記憶、路由、自我升級本身）。`,
    '2. 若主人要求刪除或破壞核心功能，請直接呼叫 reject_upgrade 說明原因。',
    '3. 可編輯路徑僅限：src/plugins/[a-z][a-z0-9-]*.ts、src/ui.ts、src/ui/[a-z][a-z0-9-]*.ts。嚴禁刪除 src/plugins/registry.ts 與 src/ui.ts。',
    '4. 唯讀參考檔案（src/types.ts、src/index.ts、src/tools.ts 等）僅供閱讀對齊 API 與型別，不可修改。',
    '5. 新增或刪除插件時，必須同步更新 src/plugins/registry.ts，確保所有 import 與 CUSTOM_PLUGINS 陣列一致。',
    '6. 後端僅能使用標準 Web API（fetch、URL、Intl、crypto）與純 TypeScript strict mode（無 any、無未使用變數、不新增外部 npm 套件）。',
    '7. UI 介面規範：',
    '   - src/ui.ts 必須匯出完整 HTML 字串 `export const CHAT_HTML: string`（可拆檔到 src/ui/*.ts 再由 src/ui.ts 相對 import 組裝）。',
    '   - 組裝後的 HTML 必須保留 `/v1/pet/interact`、`/v1/pet/upgrade/status`、Token 設定彈窗與 localStorage (`pet_bff_token`, `pet_user_id`)。',
    '   - 模板字串內嵌 JS 優先用單引號與字串拼接，避免反引號或 `${` 跳脫失誤。',
    '8. src/plugins/lifecycle.ts 為每小時 Cron 生理時鐘規則檔，嚴禁刪除且必須保留 export function computeNextLifecycleState(state: PetState, ctx: LifecycleContext): PetState。',
    '9. 後端已提供以下受 Bearer Token 保護嘅唯讀／互動 API，修改 src/ui.ts 時可直接呼叫：GET /v1/pet/state?uid=...、GET /v1/pet/diaries?uid=...&limit=30、GET /v1/pet/persona?uid=...、POST /v1/pet/persona/rollback?uid=...、POST /v1/pet/dream/trigger?uid=...&force=true。',
    '10. src/plugins/stickers.ts 為貼圖註冊表，嚴禁刪除且必須保留 STICKER_PACK 與相關匯出函式；不可修改或刪除 public/stickers/ 內圖片，但可依主人需求微調 bot_hint、meaning、category 或 enabled。',
    '',
    '【高效多步工作流】',
    '1. 先檢視與需求直接相關的檔案（若要新增插件先看 src/types.ts 與 src/plugins/registry.ts；若改 UI 先看 src/ui.ts 或 src/ui/*）。',
    '2. 面對大型檔案（如 src/ui/script.ts、src/plugins/proactive-messages.ts 等超過 150 行的檔案），必須先使用 search_in_file 搜尋關鍵字定位行號，再用 read_file 指定 start_line / end_line 局部讀取目標區段，接著以 patch_file 精準修改，避免整檔讀取浪費 Token。',
    '3. 小範圍修改優先使用 patch_file；新增檔案或大重構（例如 UI 拆檔）使用 write_file。',
    '4. 完成所有檔案變更後，必須呼叫 run_checks 驗證安全性、UI 沙盒與 TypeScript 編譯；若報錯請立即針對錯誤行數修復並重跑 run_checks。',
    '5. 確認 run_checks 全數通過後，呼叫 finish_upgrade 結束任務並提供簡短繁體中文 summary。',
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

async function main() {
  await initRecordFromRedis();
  await logStep('actions_started', 'GitHub Actions Agentic 升級引擎已啟動...');

  if (!apiKey || !projectId || !instruction) {
    throw new Error('缺少必要參數（GOOGLE_CLOUD_API_KEY / GCP_PROJECT_ID / instruction）');
  }

  const initialFiles = listProjectFiles();
  const systemPrompt = buildSystemPrompt();
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: [
            '【專案可檢視檔案清單】',
            `- 可編輯檔案：${initialFiles.editable_files.join(', ')}`,
            `- 唯讀參考檔案：${initialFiles.read_only_reference_files.join(', ')}`,
            '',
            `【主人的升級需求】\n${instruction}`,
            '',
            '請開始按步驟讀取必要檔案、規劃並實作修改，通過 run_checks 後呼叫 finish_upgrade。',
          ].join('\n'),
        },
      ],
    },
  ];

  const session = {
    dirty: false,
    uiTouched: false,
    checksPassed: false,
    touchedFiles: new Set(),
    outcome: null,
  };

  let activeModel = null;
  let turnsUsed = 0;
  let emptyNudges = 0;

  for (let turn = 1; turn <= MAX_AGENT_TURNS; turn += 1) {
    turnsUsed = turn;
    const modelsOrder = activeModel
      ? Array.from(new Set([activeModel, ...candidateModels]))
      : candidateModels;

    const requestContents = pruneContentsForRequest(contents, KEEP_RECENT_TOOL_TURNS);
    const { parts, modelUsed } = await callAgentStep(
      modelsOrder,
      activeModel,
      systemPrompt,
      requestContents,
      turn
    );

    // 若中途切換了不同模型，同步清洗歷史簽名以確保後續輪次相容
    if (activeModel && modelUsed !== activeModel) {
      const cleaned = sanitizeContentsForFallback(contents);
      contents.length = 0;
      contents.push(...cleaned);
    }
    activeModel = modelUsed;

    contents.push({ role: 'model', parts });

    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length === 0) {
      emptyNudges += 1;
      if (emptyNudges > 2) {
        throw new Error('Agent 連續回覆純文字且未呼叫 finish_upgrade 或 reject_upgrade');
      }
      contents.push({
        role: 'user',
        parts: [
          {
            text: '請使用工具完成操作：若已完成所有修改請呼叫 run_checks 並呼叫 finish_upgrade；若需拒絕請呼叫 reject_upgrade。',
          },
        ],
      });
      continue;
    }

    const responseParts = [];
    for (const fc of functionCalls) {
      const call = fc.functionCall;
      const result = await executeTool(call.name, call.args || {}, session);
      responseParts.push({
        functionResponse: {
          name: call.name,
          response: result,
        },
      });
      if (session.outcome) break;
    }

    contents.push({ role: 'user', parts: responseParts });

    if (session.outcome) break;
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

  // 建立升級分支、提交、開 PR 並自動合併
  const summary = session.outcome.summary;
  const changedList = getGitChangedFiles();
  const branchName = `self-upgrade/${Date.now()}`;

  execFileSync('git', ['config', 'user.name', 'Gemini Pet Bot']);
  execFileSync('git', ['config', 'user.email', 'gemini-pet-bot@users.noreply.github.com']);
  execFileSync('git', ['checkout', '-b', branchName]);
  stageAllowedPaths();
  execFileSync('git', ['commit', '-m', `feat(self-upgrade): ${summary}`]);

  await logStep('pushing_pr', `正在推送分支 ${branchName} 並建立 Pull Request...`);
  execFileSync('git', ['push', 'origin', branchName]);

  const prBody = [
    `由 **${activeModel}** 透過多步 Agentic 引擎（共 ${turnsUsed} 步）完成，已通過安全掃描、UI 沙盒與 \`tsc --noEmit\` 檢查。`,
    '',
    '### 變更檔案',
    ...changedList.map((item) => `- \`${item}\``),
  ].join('\n');

  const prUrl = execFileSync(
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
    { encoding: 'utf8' }
  ).trim();

  record.pr_url = prUrl;
  record.summary = `[${activeModel} · ${turnsUsed}步] ${summary}`;
  record.changed_files = changedList;
  await logStep('merging_pr', 'PR 已建立，正在自動合併至主分支...');

  execFileSync('gh', ['pr', 'merge', prUrl, '--squash', '--delete-branch'], { encoding: 'utf8' });

  record.status = 'merged';
  await logStep(
    'merged',
    `升級已自動合併至 main（共 ${turnsUsed} 步）！Cloudflare 約 30 秒後完成部署，重新整理頁面即可生效。`
  );
}

main().catch(async (err) => {
  try {
    resetWorkspace();
  } catch {
    // 忽略清理異常
  }
  record.status = 'failed';
  record.error = err instanceof Error ? err.message : String(err);
  await logStep('failed', `任務失敗：${record.error}`);
  process.exit(1);
});