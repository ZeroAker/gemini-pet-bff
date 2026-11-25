import { Hono } from 'hono';
import { GeminiService, MemoryService, StateService } from './services';
import type { Env, InteractRequest } from './types';

const app = new Hono<{ Bindings: Env }>();

// 新增：捕捉所有錯誤並把詳細原因回傳給手機端顯示
app.onError((err, c) => {
  const status = 'status' in err && typeof err.status === 'number' ? err.status : 500;
  return c.json(
    {
      error: err.message || 'Unknown Error',
      detail: String(err),
    },
    status as 400 | 500
  );
});

app.get('/health', (c) => c.json({ status: 'ok', service: 'gemini-pet-bff' }));

app.post('/v1/pet/interact', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    return c.json({ error: 'Unauthorized: Token 不符' }, 401);
  }

  // 新增：明確檢查 JSON 格式是否正確
  let body: InteractRequest;
  try {
    body = await c.req.json<InteractRequest>();
  } catch {
    return c.json({ error: 'Bad Request: 手機傳送的 JSON 格式有誤，請檢查引號或變數設定' }, 400);
  }

  const userId = body.user_id || 'default_user';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const memorySvc = new MemoryService(c.env.MEM0_API_KEY);
  const geminiSvc = new GeminiService(c.env);

  const locked = await stateSvc.acquireLock(userId);
  if (!locked) {
    return c.json({ error: 'Pet is busy responding to another device' }, 429);
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