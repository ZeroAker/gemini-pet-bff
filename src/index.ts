import { Hono } from 'hono';
import { computeNextLifecycleState } from './plugins/lifecycle';
import { GeminiService, MemoryService, StateService } from './services';
import type { Env, InteractRequest, PetState } from './types';
import { CHAT_HTML } from './ui';

const app = new Hono<{ Bindings: Env }>();

function getHongKongHour(now: Date): number {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const parsed = Number.parseInt(hourStr, 10);
  return Number.isNaN(parsed) ? 0 : parsed % 24;
}

async function runLifecycleTick(userId: string, stateSvc: StateService): Promise<PetState> {
  const current = await stateSvc.getPetState(userId);
  const now = new Date();
  const lastActiveMs = Date.parse(current.last_active_at || current.updated_at);
  const hoursSinceLastActive = Number.isNaN(lastActiveMs)
    ? 0
    : Math.max(0, (now.getTime() - lastActiveMs) / 3_600_000);

  try {
    const next = computeNextLifecycleState(current, {
      now,
      hkHour: getHongKongHour(now),
      hoursSinceLastActive,
    });
    await stateSvc.savePetState(userId, next);
    return next;
  } catch (err) {
    console.error(`[Lifecycle:${userId}] 規則執行異常，保留原狀態:`, err);
    return current;
  }
}

app.get('/', (c) => c.html(CHAT_HTML));

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
    const now = new Date().toISOString();
    const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
    const geminiSvc = new GeminiService(c.env);
    const res = await geminiSvc.generateReply({
      userId: 'test_user',
      userMessage: q,
      devicePlatform: 'android',
      state: {
        affection: 50,
        energy: 80,
        mood: 'idle',
        status_note: '測試模式',
        last_device: 'android',
        last_active_at: now,
        updated_at: now,
      },
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

app.get('/v1/pet/state', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const state = await stateSvc.getPetState(userId);
  return c.json({ ok: true, pet_state: state });
});

app.post('/v1/pet/lifecycle/tick', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const next = await runLifecycleTick(userId, stateSvc);
  return c.json({ ok: true, pet_state: next });
});

// 查詢桌寵日記本
app.get('/v1/pet/diaries', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = c.req.query('uid') || 'zero_main';
  const limitRaw = Number.parseInt(c.req.query('limit') || '30', 10);
  const limit = Number.isNaN(limitRaw) ? 30 : limitRaw;
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const diaries = await stateSvc.getDiaries(userId, limit);
  return c.json({ ok: true, count: diaries.length, diaries });
});

// 查詢目前性格演化狀態與近期近況快照
app.get('/v1/pet/persona', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const profile = await stateSvc.getDreamProfile(userId);
  return c.json({
    ok: true,
    persona: profile.persona,
    recent_snapshot: profile.recent_snapshot,
    last_dream_date: profile.last_dream_date || null,
    history_count: profile.persona_history.length,
    updated_at: profile.updated_at,
  });
});

// 一鍵還原至上一版性格
app.post('/v1/pet/persona/rollback', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const result = await stateSvc.rollbackPersona(userId);
  return c.json(result);
});

// 手動派發一次「發夢」任務至 GitHub Actions（方便即時測試）
app.post('/v1/pet/dream/trigger', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = (c.env.GITHUB_TOKEN || '').trim();
  const owner = (c.env.GITHUB_OWNER || '').trim();
  const repo = (c.env.GITHUB_REPO || '').trim();
  const branch = (c.env.GITHUB_BRANCH || 'main').trim();
  if (!token || !owner || !repo) {
    return c.json({ ok: false, error: '尚未設定 GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO' }, 500);
  }

  const userId = c.req.query('uid') || 'zero_main';
  const force = c.req.query('force') === 'true' ? 'true' : 'false';

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/nightly-dream.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GeminiPetDreamTrigger/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: branch,
        inputs: { user_id: userId, force },
      }),
    }
  );

  if (!res.ok) {
    return c.json({ ok: false, error: `派發失敗 (${res.status}): ${(await res.text()).slice(0, 200)}` }, 502);
  }

  return c.json({
    ok: true,
    status: 'dispatched',
    actions_url: `https://github.com/${owner}/${repo}/actions/workflows/nightly-dream.yml`,
  });
});

app.get('/v1/pet/upgrade/status', async (c) => {
  const auth = c.req.header('Authorization');
  if (auth !== `Bearer ${c.env.BFF_ACCESS_TOKEN}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const status = await stateSvc.getUpgradeStatus(userId);

  if (!status) {
    return c.json({ status: 'idle', logs: [] });
  }

  const ageMs = Date.now() - Date.parse(status.updated_at);
  const isStale = status.status === 'running' && ageMs > 1_200_000;

  return c.json({
    ...status,
    elapsed_sec: status.started_at ? Math.floor((Date.now() - Date.parse(status.started_at)) / 1000) : 0,
    is_stale: isStale,
  });
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
    const [state, history, memories, dreamProfile] = await Promise.all([
      stateSvc.getPetState(userId),
      stateSvc.getRecentHistory(userId),
      memorySvc.searchMemories(userId, body.input.content),
      stateSvc.getDreamProfile(userId),
    ]);

    const aiResult = await geminiSvc.generateReply({
      userId,
      userMessage: body.input.content,
      devicePlatform: body.device.platform,
      deviceContext: body.device.context,
      state,
      memories,
      history,
      dreamProfile,
      stateSvc,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const nextState: PetState = {
      ...state,
      affection: Math.min(100, Math.max(0, state.affection + aiResult.affection_delta)),
      energy: Math.max(10, state.energy - 1),
      mood: aiResult.emotion,
      status_note: '啱啱同主人傾完計',
      last_device: body.device.platform,
      last_active_at: nowIso,
      updated_at: nowIso,
    };

    const newTurns = [
      { role: 'user' as const, content: body.input.content },
      { role: 'assistant' as const, content: aiResult.reply },
    ];

    c.executionCtx.waitUntil(
      Promise.all([
        stateSvc.registerActiveUser(userId),
        stateSvc.savePetState(userId, nextState),
        stateSvc.appendHistory(userId, newTurns),
        stateSvc.appendDreamInbox(userId, [
          { role: 'user', content: body.input.content, ts: nowMs },
          { role: 'assistant', content: aiResult.reply, ts: nowMs + 1 },
        ]),
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

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const stateSvc = new StateService(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
    const job = (async () => {
      const users = await stateSvc.getActiveUsers();
      const targets = users.length > 0 ? users : ['zero_main'];
      await Promise.all(targets.map((uid) => runLifecycleTick(uid, stateSvc)));
    })();
    ctx.waitUntil(job);
  },
};