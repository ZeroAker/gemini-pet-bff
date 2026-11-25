import type { StateService } from './services';

// 提供給 Gemini Vertex AI 的工具規格定義
export const AGENT_TOOL_DECLARATIONS = [
  {
    name: 'get_current_time',
    description: '取得目前的準確日期、星期與時間（香港/台北時間 UTC+8）。當使用者詢問現在幾點、今天星期幾、或是需要計算日期時呼叫。',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'manage_todos',
    description: '管理主人的跨裝置待辦清單與提醒備忘（存於雲端，PC與手機同步）。支援新增(add)、查詢(list)、標記完成(complete)與刪除(delete)。',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: '操作類型：add | list | complete | delete',
        },
        text: {
          type: 'STRING',
          description: '待辦事項內容（action 為 add 時必填）',
        },
        id: {
          type: 'STRING',
          description: '待辦事項 ID（action 為 complete 或 delete 時必填）',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'fetch_webpage',
    description: '讀取指定網址(URL)的純文字內容，用於幫主人總結文章、查看網頁資訊。',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: {
          type: 'STRING',
          description: '必須以 http:// 或 https:// 開頭的完整網址',
        },
      },
      required: ['url'],
    },
  },
];

// 實際執行工具的派發器（回傳值必須是物件，符合 Vertex AI functionResponse 規範）
export async function executeAgentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { userId: string; stateSvc: StateService }
): Promise<Record<string, unknown>> {
  try {
    if (name === 'get_current_time') {
      const now = new Date();
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
      }).format(now);
      return { current_time: formatted, timezone: 'Asia/Hong_Kong (UTC+8)' };
    }

    if (name === 'manage_todos') {
      const action = String(args.action || 'list');
      const todos = await ctx.stateSvc.getTodos(ctx.userId);

      if (action === 'list') {
        return { todos, count: todos.length };
      }

      if (action === 'add') {
        const text = String(args.text || '').trim();
        if (!text) return { error: '缺少待辦內容 text' };
        const newItem = {
          id: String(Date.now()).slice(-4),
          text,
          done: false,
          created_at: new Date().toISOString(),
        };
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
      if (!/^https?:\/\//i.test(url)) {
        return { error: '無效的網址格式' };
      }
      const res = await fetch(url, {
        headers: { 'User-Agent': 'GeminiPetAgent/1.0' },
      });
      if (!res.ok) {
        return { error: `無法存取網頁，狀態碼 ${res.status}` };
      }
      const html = await res.text();
      // 去除 script/style 與 HTML 標籤，截取前 3500 字供模型閱讀
      const cleanText = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3500);
      return { url, content_excerpt: cleanText };
    }

    return { error: `未知工具：${name}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}