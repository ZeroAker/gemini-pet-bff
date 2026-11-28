import type { Context, Next } from 'hono';
import type { Env } from '../types';

/**
 * 驗證 Bearer Token 中介軟體：
 * - `/v1/pet/interact` 失敗時回傳 200 診斷訊息以相容前端對話氣泡顯示
 * - 其餘受保護路由失敗時回傳 401 Unauthorized
 */
export async function requireBffAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    if (c.req.path === '/v1/pet/interact') {
      return c.json({ reply: '⚠️ 診斷錯誤：Authorization Token 不符' }, 200);
    }
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
}
