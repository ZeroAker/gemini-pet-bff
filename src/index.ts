import { Hono } from 'hono';
import { DreamService } from './dream';
import { requireBffAuth } from './middleware/auth';
import { computeNextLifecycleState } from './plugins/lifecycle';
import { petCareGamePlugin } from './plugins/pet-care-game';
import {
  claimProactiveRuleTriggerForApi,
  getProactiveScheduleForApi,
  setProactiveScheduleForApi,
} from './plugins/proactive-messages';
import { getStickerById, getUserStickers, STICKER_PACK_VERSION, toStickerPayload } from './plugins/stickers';
import { handlePetInteract } from './routes/pet-interact';
import { GeminiService, StateService } from './services';
import type { Env, PetState } from './types';
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

app.get('/v1/stickers', (c) =>
  c.json({
    ok: true,
    pack_version: STICKER_PACK_VERSION,
    stickers: getUserStickers().map((s) => ({
      id: s.id,
      url: s.url,
      label: s.label,
      category: s.category,
      moods: s.moods ?? [],
    })),
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

// 統一掛載 Bearer Token 認證中介軟體
app.use('/v1/pet/*', requireBffAuth);

app.get('/v1/pet/state', async (c) => {
  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const state = await stateSvc.getPetState(userId);
  return c.json({ ok: true, pet_state: state });
});

app.get('/v1/pet/history', async (c) => {
  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const turns = await stateSvc.getRecentHistory(userId);
  const history = turns.map((t) => {
    const st = t.sticker ? getStickerById(t.sticker) : undefined;
    return {
      role: t.role === 'assistant' ? 'bot' : 'user',
      text: t.content || '',
      meta: t.meta || '',
      time: typeof t.ts === 'number' ? t.ts : null,
      sticker: st ? toStickerPayload(st) : null,
    };
  });
  return c.json({ ok: true, count: history.length, history });
});

app.post('/v1/pet/lifecycle/tick', async (c) => {
  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const next = await runLifecycleTick(userId, stateSvc);
  return c.json({ ok: true, pet_state: next });
});

app.post('/v1/pet/care', async (c) => {
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const userId =
    (typeof body.uid === 'string' && body.uid.trim()) ||
    c.req.query('uid') ||
    'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);

  const locked = await stateSvc.acquireLock(userId);
  if (!locked) {
    return c.json({ ok: false, error: '裝置狀態同步中，請稍候再試' }, 429);
  }

  try {
    const result = await petCareGamePlugin.execute(body, { userId, stateSvc });
    return c.json(result);
  } finally {
    await stateSvc.releaseLock(userId);
  }
});

// 查詢桌寵日記本
app.get('/v1/pet/diaries', async (c) => {
  const userId = c.req.query('uid') || 'zero_main';
  const limitRaw = Number.parseInt(c.req.query('limit') || '30', 10);
  const limit = Number.isNaN(limitRaw) ? 30 : limitRaw;
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const diaries = await stateSvc.getDiaries(userId, limit);
  return c.json({ ok: true, count: diaries.length, diaries });
});

// 查詢已儲存的程序性技能（Skills / SOP）
app.get('/v1/pet/skills', async (c) => {
  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const skillMap = await stateSvc.getSkills(userId);
  const skills = Object.values(skillMap);
  return c.json({ ok: true, count: skills.length, skills });
});

// 查詢目前性格演化狀態與近期近況快照
app.get('/v1/pet/persona', async (c) => {
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
  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const result = await stateSvc.rollbackPersona(userId);
  return c.json(result);
});

// 手動觸發一次「發夢」反思與日記生成（直接於 Cloudflare Workers 執行）
app.post('/v1/pet/dream/trigger', async (c) => {
  const userId = c.req.query('uid') || 'zero_main';
  const force = c.req.query('force') === 'true';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const dreamSvc = new DreamService(c.env);

  try {
    const result = await dreamSvc.processUser(userId, stateSvc, { force });
    if (!result.ok) {
      return c.json({ ok: false, error: result.error || '發夢執行失敗' }, 500);
    }
    return c.json({
      ...result,
      status: result.skipped ? 'skipped' : 'completed',
      engine: 'cloudflare-workers',
    });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get('/v1/pet/upgrade/status', async (c) => {
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

app.get('/v1/pet/proactive', async (c) => {
  const userId = c.req.query('uid') || 'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const store = await getProactiveScheduleForApi(userId, stateSvc);
  return c.json({
    ok: true,
    userId: store.userId,
    globalEnabled: store.globalEnabled,
    timezone: store.timezone,
    updatedAt: store.updatedAt,
    rules: store.rules,
  });
});

async function handleSetProactiveSchedule(c: {
  req: {
    query: (k: string) => string | undefined;
    json: <T>() => Promise<T>;
  };
  env: Env;
  json: (data: unknown, status?: number) => Response;
}): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const userId =
    (typeof body.uid === 'string' && body.uid.trim()) ||
    c.req.query('uid') ||
    'zero_main';
  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);

  const locked = await stateSvc.acquireProactiveLock(userId);
  if (!locked) {
    return c.json({ ok: false, error: '主動排程同步中，請稍候再試' }, 429);
  }

  try {
    const store = await setProactiveScheduleForApi(userId, stateSvc, {
      globalEnabled: body.globalEnabled,
      timezone: body.timezone,
      rules: body.rules,
    });
    return c.json({
      ok: true,
      userId: store.userId,
      globalEnabled: store.globalEnabled,
      timezone: store.timezone,
      updatedAt: store.updatedAt,
      rules: store.rules,
    });
  } finally {
    await stateSvc.releaseProactiveLock(userId);
  }
}

app.post('/v1/pet/proactive', (c) => handleSetProactiveSchedule(c as never));
app.put('/v1/pet/proactive', (c) => handleSetProactiveSchedule(c as never));

app.post('/v1/pet/proactive/claim', async (c) => {
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const userId =
    (typeof body.uid === 'string' && body.uid.trim()) ||
    c.req.query('uid') ||
    'zero_main';
  const ruleId = typeof body.ruleId === 'string' ? body.ruleId.trim() : '';
  if (!ruleId) {
    return c.json({ ok: false, error: 'Missing ruleId' }, 400);
  }

  const stateSvc = new StateService(c.env.UPSTASH_REDIS_REST_URL, c.env.UPSTASH_REDIS_REST_TOKEN);
  const locked = await stateSvc.acquireProactiveLock(userId);
  if (!locked) {
    return c.json({ ok: false, claimed: false, error: '排程觸發檢查中，請稍候再試' }, 429);
  }

  try {
    const suppressRuleIds = Array.isArray(body.suppressRuleIds)
      ? body.suppressRuleIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : undefined;
    const result = await claimProactiveRuleTriggerForApi(userId, stateSvc, {
      ruleId,
      suppressRuleIds,
      timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
      force: Boolean(body.force),
    });
    return c.json({
      ok: true,
      claimed: result.claimed,
      reason: result.reason || null,
      userId: result.store.userId,
      globalEnabled: result.store.globalEnabled,
      timezone: result.store.timezone,
      updatedAt: result.store.updatedAt,
      rules: result.store.rules,
    });
  } finally {
    await stateSvc.releaseProactiveLock(userId);
  }
});

app.post('/v1/pet/interact', handlePetInteract);

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const stateSvc = new StateService(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
    const hkHour = getHongKongHour(new Date());

    const job = (async () => {
      const users = await stateSvc.getActiveUsers();
      const targets = users.length > 0 ? users : ['zero_main'];
      await Promise.all(targets.map((uid) => runLifecycleTick(uid, stateSvc)));

      // 每日香港時間 03:00 自動執行深夜「發夢」記憶整理與性格演化
      if (hkHour === 3) {
        const dreamSvc = new DreamService(env);
        const dreamResults = await dreamSvc.runForAllUsers(stateSvc, { force: false });
        console.log('[Cron:NightlyDream]', JSON.stringify(dreamResults));
      }
    })();
    ctx.waitUntil(job);
  },
};
