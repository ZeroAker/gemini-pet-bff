import { CUSTOM_PLUGINS } from './plugins/registry';
import type { StateService } from './services';
import type { ComplexityTier, Env, ToolDeclaration } from './types';
import { PROTECTED_CORE_TOOLS, SelfUpgradeService } from './upgrader';

const CORE_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'get_current_time',
    description: '取得目前日期、星期與時間（UTC+8）。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'manage_todos',
    description: '管理待辦清單（add/list/complete/delete）。',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'add | list | complete | delete' },
        text: { type: 'STRING', description: '待辦內容（add 必填）' },
        id: { type: 'STRING', description: '待辦 ID（complete/delete 必填）' },
      },
      required: ['action'],
    },
  },
  {
    name: 'fetch_webpage',
    description: '讀取指定 URL 純文字內容。',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: '完整 http/https 網址' },
      },
      required: ['url'],
    },
  },
  {
    name: 'request_self_upgrade',
    description: '要求桌寵自我升級、增刪改後端插件或修改 PWA 前端 UI。',
    parameters: {
      type: 'OBJECT',
      properties: {
        instruction: {
          type: 'STRING',
          description: '升級、插件或 UI 修改規格說明',
        },
      },
      required: ['instruction'],
    },
  },
  {
    name: 'check_upgrade_status',
    description: '查詢最近升級進度/PR 與已安裝自訂插件。',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

// 過濾掉任何試圖冒充核心名稱的插件，確保核心不可被覆寫
const CORE_NAME_SET = new Set<string>(PROTECTED_CORE_TOOLS);
const SAFE_CUSTOM_PLUGINS = CUSTOM_PLUGINS.filter((p) => !CORE_NAME_SET.has(p.declaration.name));

const ALWAYS_ON_CORE_TOOLS = new Set(['get_current_time', 'manage_todos', 'fetch_webpage']);
const UPGRADE_TOOL_NAMES = new Set([
  'request_self_upgrade',
  'check_upgrade_status',
  'fetch_upgrade_actions_status',
]);
const PET_CARE_TOOL_NAMES = new Set(['manage_pet_care_game']);
const PROACTIVE_TOOL_NAMES = new Set(['manage_proactive_messages']);
const SCOPED_TOOL_NAMES = new Set([
  ...UPGRADE_TOOL_NAMES,
  ...PET_CARE_TOOL_NAMES,
  ...PROACTIVE_TOOL_NAMES,
]);

const UPGRADE_INTENT_PATTERN =
  /升級|upgrade|新增功能|加一個|修改功能|刪除功能|移除功能|插件|plugin|進度|介面|ui|外觀|配色|主題|排版|按鈕|畫面|貼圖規則|作息規則|github|actions|workflow|\bpr\b|部署|deploy/i;
const PET_CARE_INTENT_PATTERN =
  /餵|吃|食|點心|零食|小魚乾|蛋糕|咖啡|肚子|餓|活力|能量|猜拳|石頭|剪刀|布|接愛心|愛心|小遊戲|玩遊戲|\bgame\b|\bfeed\b|\bsnack\b|\brps\b/i;
const PROACTIVE_INTENT_PATTERN =
  /提醒|排程|定時|鬧鐘|主動訊息|主動通知|閒置|追蹤升級|追蹤進度|回報升級|proactive|schedule|remind/i;
const CORE_ONLY_INTENT_PATTERN =
  /幾點|時間|日期|星期|\btime\b|待辦|todo|清單|記下|備忘|https?:\/\/|網頁|連結|網址|文章|摘要/i;

export function getAllToolDeclarations(): ToolDeclaration[] {
  return [...CORE_TOOL_DECLARATIONS, ...SAFE_CUSTOM_PLUGINS.map((p) => p.declaration)];
}

export function getToolDeclarationsForIntent(
  userMessage: string,
  tier?: ComplexityTier
): ToolDeclaration[] {
  const allDeclarations = getAllToolDeclarations();
  if (tier === 'complex') {
    return allDeclarations;
  }

  const trimmed = userMessage.trim();
  const wantsUpgrade = UPGRADE_INTENT_PATTERN.test(trimmed);
  const wantsPetCare = PET_CARE_INTENT_PATTERN.test(trimmed);
  const wantsProactive = PROACTIVE_INTENT_PATTERN.test(trimmed);
  const wantsCoreOnly = CORE_ONLY_INTENT_PATTERN.test(trimmed);

  // 無法明確分類時，安全回退掛載全部工具，避免漏判
  if (!wantsUpgrade && !wantsPetCare && !wantsProactive && !wantsCoreOnly) {
    return allDeclarations;
  }

  return allDeclarations.filter((decl) => {
    if (ALWAYS_ON_CORE_TOOLS.has(decl.name)) return true;
    if (UPGRADE_TOOL_NAMES.has(decl.name)) return wantsUpgrade;
    if (PET_CARE_TOOL_NAMES.has(decl.name)) return wantsPetCare;
    if (PROACTIVE_TOOL_NAMES.has(decl.name)) return wantsProactive;
    // 其他未分類的未來自訂插件預設保留，避免影響後續自我升級擴充
    return !SCOPED_TOOL_NAMES.has(decl.name);
  });
}

export async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: {
    userId: string;
    stateSvc: StateService;
    env: Env;
    waitUntil?: (p: Promise<unknown>) => void;
  }
): Promise<Record<string, unknown>> {
  try {
    if (name === 'get_current_time') {
      const formatted = new Intl.DateTimeFormat('zh-HK', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
      return { current_time: formatted, timezone: 'Asia/Hong_Kong (UTC+8)' };
    }

    if (name === 'manage_todos') {
      const action = String(args.action || 'list');
      const todos = await ctx.stateSvc.getTodos(ctx.userId);
      if (action === 'list') return { todos, count: todos.length };
      if (action === 'add') {
        const text = String(args.text || '').trim();
        if (!text) return { error: '缺少待辦內容 text' };
        const newItem = { id: String(Date.now()).slice(-4), text, done: false, created_at: new Date().toISOString() };
        todos.push(newItem);
        await ctx.stateSvc.saveTodos(ctx.userId, todos);
        return { status: 'added', item: newItem };
      }
      if (action === 'complete') {
        const id = String(args.id || '');
        const target = todos.find((t) => t.id === id);
        if (!target) return { error: `找不到 ID 為 ${id} 的待辦事項`, todos };
        target.done = true;
        await ctx.stateSvc.saveTodos(ctx.userId, todos);
        return { status: 'completed', item: target };
      }
      if (action === 'delete') {
        const id = String(args.id || '');
        const filtered = todos.filter((t) => t.id !== id);
        await ctx.stateSvc.saveTodos(ctx.userId, filtered);
        return { status: 'deleted', remaining: filtered.length };
      }
      return { error: `不支援的 action: ${action}` };
    }

    if (name === 'fetch_webpage') {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return { error: '無效的網址格式' };
      const res = await fetch(url, { headers: { 'User-Agent': 'GeminiPetAgent/1.0' } });
      if (!res.ok) return { error: `無法存取網頁，狀態碼 ${res.status}` };
      const html = await res.text();
      const cleanText = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3500);
      return { url, content_excerpt: cleanText };
    }

    if (name === 'request_self_upgrade') {
      const instruction = String(args.instruction || '').trim();
      if (!instruction) return { error: '請提供具體的升級需求說明' };

      const upgrader = new SelfUpgradeService(ctx.env);
      return await upgrader.dispatchUpgradeJob(ctx.userId, instruction, ctx.stateSvc);
    }

    if (name === 'check_upgrade_status') {
      const latest = await ctx.stateSvc.getUpgradeStatus(ctx.userId);
      return {
        latest_upgrade: latest || '尚無升級紀錄',
        installed_custom_plugins: SAFE_CUSTOM_PLUGINS.map((p) => ({
          name: p.declaration.name,
          description: p.declaration.description,
        })),
      };
    }

    // 執行自訂插件（獨立沙盒攔截，避免單一插件異常拖垮核心）
    const plugin = SAFE_CUSTOM_PLUGINS.find((p) => p.declaration.name === name);
    if (plugin) {
      return await plugin.execute(args, { userId: ctx.userId, stateSvc: ctx.stateSvc });
    }

    return { error: `未知工具：${name}` };
  } catch (err) {
    return { error: `工具 ${name} 執行異常：${err instanceof Error ? err.message : String(err)}` };
  }
}