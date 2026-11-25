import { CUSTOM_PLUGINS } from './plugins/registry';
import type { StateService } from './services';
import type { Env, ToolDeclaration } from './types';
import { PROTECTED_CORE_TOOLS, SelfUpgradeService } from './upgrader';

const CORE_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'get_current_time',
    description: '取得目前的準確日期、星期與時間（香港/台北時間 UTC+8）。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'manage_todos',
    description: '管理主人的跨裝置待辦清單（add/list/complete/delete）。',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'add | list | complete | delete' },
        text: { type: 'STRING', description: '待辦事項內容（add 必填）' },
        id: { type: 'STRING', description: '待辦事項 ID（complete 或 delete 必填）' },
      },
      required: ['action'],
    },
  },
  {
    name: 'fetch_webpage',
    description: '讀取指定網址(URL)的純文字內容以進行摘要或分析。',
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
    description:
      '當主人要求桌寵自我升級、新增/修改/刪除後端自訂功能插件，或是修改 PWA 前端 UI 介面（配色、排版、按鈕、互動元件、3D 模型顯示等）時呼叫。會在 GitHub Actions 執行安全檢查與自動部署，並保護核心功能不受損害。',
    parameters: {
      type: 'OBJECT',
      properties: {
        instruction: {
          type: 'STRING',
          description: '清楚描述要修改的 UI 介面細節，或要新增、修改、刪除的功能規格',
        },
      },
      required: ['instruction'],
    },
  },
  {
    name: 'check_upgrade_status',
    description: '查詢最近一次桌寵自我升級任務的執行進度、PR 連結或結果，也可列出目前已安裝的所有自訂插件。',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

// 過濾掉任何試圖冒充核心名稱的插件，確保核心不可被覆寫
const CORE_NAME_SET = new Set<string>(PROTECTED_CORE_TOOLS);
const SAFE_CUSTOM_PLUGINS = CUSTOM_PLUGINS.filter((p) => !CORE_NAME_SET.has(p.declaration.name));

export function getAllToolDeclarations(): ToolDeclaration[] {
  return [...CORE_TOOL_DECLARATIONS, ...SAFE_CUSTOM_PLUGINS.map((p) => p.declaration)];
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
      return await plugin.execute(args, { userId: ctx.userId });
    }

    return { error: `未知工具：${name}` };
  } catch (err) {
    return { error: `工具 ${name} 執行異常：${err instanceof Error ? err.message : String(err)}` };
  }
}