import { Hono } from 'hono';
import { GeminiService, MemoryService, StateService } from './services';
import type { Env, InteractRequest } from './types';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok', service: 'gemini-pet-bff' }));

app.post('/v1/pet/interact', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<InteractRequest>();
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

    // 背景非同步寫入狀態與長期記憶，不拖慢手機端回應速度
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