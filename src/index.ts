import { Hono } from 'hono';
import { GeminiService, MemoryService, StateService } from './services';
import type { Env, InteractRequest } from './types';

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  return c.json(
    {
      reply: `⚠️ 診斷錯誤：${err.message || String(err)}`,
      action: { emotion: 'thinking' },
    },
    200
  );
});

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'gemini-pet-bff',
    loaded_env_keys: Object.keys(c.env),
  })
);

app.get('/test-models', async (c) => {
  try {
    const geminiSvc = new GeminiService(c.env);
    const results = await geminiSvc.probeModels();
    return c.json({
      location: c.env.GCP_LOCATION || 'global',
      project: c.env.GCP_PROJECT_ID || '(auto)',
      results,
    });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/test-gemini', async (c) => {
  try {
    const q = c.req.query('q') || '打個招呼';
    const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
    const geminiSvc = new GeminiService(c.env);
    const res = await geminiSvc.generateReply({
      userId: 'test_user',
      userMessage: q,
      devicePlatform: 'android',
      state: { affection: 50, energy: 80, last_device: 'android', updated_at: new Date().toISOString() },
      memories: [],
      history: [],
      stateSvc,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });
    return c.json({ ok: true, query: q, result: res });
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
    return c.json({ reply: '⚠️ 診斷錯誤：裝置鎖定中，請稍候再試' }, 200);
  }

  try {
    const [state, history, memories] = await Promise.all([
      stateSvc.getPetState(userId),
      stateSvc.getRecentHistory(userId),
      memorySvc.searchMemories(userId, body.input.content),
    ]);

    const aiResult = await geminiSvc.generateReply({
      userId,
      userMessage: body.input.content,
      devicePlatform: body.device.platform,
      deviceContext: body.device.context,
      state,
      memories,
      history,
      stateSvc,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
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
      meta: aiResult.meta,
    });
  } finally {
    await stateSvc.releaseLock(userId);
  }
});

export default app;