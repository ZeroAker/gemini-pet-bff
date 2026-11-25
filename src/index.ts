import { Hono } from 'hono';
import { GeminiService, MemoryService, StateService } from './services';
import type { Env, InteractRequest } from './types';

const app = new Hono<{ Bindings: Env }>();

// 暫時以 HTTP 200 回傳錯誤細節，避免 HTTP Shortcuts 隱藏錯誤內容
app.onError((err, c) => {
  return c.json(
    {
      reply: `⚠️ 診斷錯誤：${err.message || String(err)}`,
      action: { emotion: 'thinking' },
    },
    200
  );
});

app.get('/health', (c) => c.json({ status: 'ok', service: 'gemini-pet-bff' }));

// 新增：直接用手機瀏覽器測試 Google Cloud Gemini 連線
app.get('/test-gemini', async (c) => {
  try {
    const geminiSvc = new GeminiService(c.env);
    const res = await geminiSvc.generateReply({
      userMessage: '打個招呼',
      devicePlatform: 'android',
      state: { affection: 50, energy: 80, last_device: 'android', updated_at: new Date().toISOString() },
      memories: [],
      history: [],
    });
    return c.json({ ok: true, result: res });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/v1/pet/interact', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    return c.json({ reply: '⚠️ 診斷錯誤：Authorization Token 不符' }, 200);
  }

  let body: InteractRequest;
  try {
    body = await c.req.json<InteractRequest>();
  } catch {
    return c.json({ reply: '⚠️ 診斷錯誤：Request Body 不是合法的 JSON 格式' }, 200);
  }

  const userId = body.user_id || 'default_user';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const memorySvc = new MemoryService(c.env.MEM0_API_KEY);
  const geminiSvc = new GeminiService(c.env);

  const locked = await stateSvc.acquireLock(userId);
  if (!locked) {
    return c.json({ reply: '⚠️ 診斷錯誤：裝置鎖定中，請稍候 15 秒再試' }, 200);
  }

  try {
    const [state, history, memories] = await Promise.all([
      stateSvc.getPetState(userId),
      stateSvc.getRecentHistory(userId),
      memorySvc.searchMemories(userId, body.input.content),
    ]);

    const aiResult = await geminiSvc.generateReply({
      userMessage: body.input.content,
      devicePlatform: body.device.platform,
      deviceContext: body.device.context,
      state,
      memories,
      history,
    });

    const nextState = {
      affection: Math.min(100, Math.max(0, state.affection + aiResult.affection_delta)),
      energy: Math.max(10, state.energy - 1),
      last_device: body.device.platform,
      updated_at: new Date().toISOString(),
    };

    const newTurns = [
      { role: 'user' as const, content: body.input.content },
      { role: 'assistant' as const, content: aiResult.reply },
    ];

    c.executionCtx.waitUntil(
      Promise.all([
        stateSvc.savePetState(userId, nextState),
        stateSvc.appendHistory(userId, newTurns),
        memorySvc.addMemory(userId, newTurns),
      ])
    );

    return c.json({
      reply: aiResult.reply,
      action: { emotion: aiResult.emotion },
      pet_state: nextState,
    });
  } finally {
    await stateSvc.releaseLock(userId);
  }
});

export default app;