import type { Context } from 'hono';
import {
  getBotStickerById,
  getStickerById,
  toStickerPayload,
} from '../plugins/stickers';
import { GeminiService, MemoryService, StateService } from '../services';
import type { Env, InteractRequest, PetState } from '../types';

export async function handlePetInteract(c: Context<{ Bindings: Env }>) {
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

  const rawContent = typeof body.input?.content === 'string' ? body.input.content.trim() : '';
  const userStickerItem = getStickerById(body.input?.sticker_id);
  const userStickerId = userStickerItem && userStickerItem.enabled ? userStickerItem.id : undefined;

  if (!rawContent && !userStickerId) {
    await stateSvc.releaseLock(userId);
    return c.json({ reply: '⚠️ 診斷錯誤：訊息內容與貼圖不可同時為空' }, 200);
  }

  const searchableText = rawContent || `[傳送貼圖：${userStickerItem!.label}（${userStickerItem!.meaning}）]`;

  try {
    const [state, history, memories, dreamProfile, skills] = await Promise.all([
      stateSvc.getPetState(userId),
      stateSvc.getRecentHistory(userId),
      memorySvc.searchMemories(userId, searchableText),
      stateSvc.getDreamProfile(userId),
      stateSvc.getSkills(userId),
    ]);

    const aiResult = await geminiSvc.generateReply({
      userId,
      userMessage: rawContent,
      userStickerId,
      devicePlatform: body.device.platform,
      deviceContext: body.device.context,
      state,
      memories,
      history,
      dreamProfile,
      skills,
      stateSvc,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    });

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const careToolUsed = Boolean(aiResult.meta?.tools_used?.includes('manage_pet_care_game'));
    const latestState = careToolUsed ? await stateSvc.getPetState(userId) : state;

    const nextState: PetState = careToolUsed
      ? {
          ...latestState,
          last_device: body.device.platform,
          last_active_at: nowIso,
          updated_at: nowIso,
        }
      : {
          ...state,
          affection: Math.min(100, Math.max(0, state.affection + aiResult.affection_delta)),
          energy: Math.max(10, state.energy - 1),
          mood: aiResult.emotion,
          status_note: '啱啱同主人傾完計',
          last_device: body.device.platform,
          last_active_at: nowIso,
          updated_at: nowIso,
        };

    const botStickerItem = getBotStickerById(aiResult.sticker);
    const botStickerPayload = botStickerItem ? toStickerPayload(botStickerItem) : null;

    const botMetaParts: string[] = [];
    if (aiResult.meta?.model_used) botMetaParts.push(aiResult.meta.model_used);
    if (aiResult.meta?.tools_used && aiResult.meta.tools_used.length > 0) {
      botMetaParts.push(`工具: ${aiResult.meta.tools_used.join(', ')}`);
    }
    const botMetaStr = botMetaParts.join(' · ');

    const newTurns = [
      { role: 'user' as const, content: rawContent, sticker: userStickerId, ts: nowMs },
      {
        role: 'assistant' as const,
        content: aiResult.reply,
        sticker: botStickerItem?.id,
        ts: nowMs + 1,
        meta: botMetaStr || undefined,
      },
    ];

    const userReadableTurn = `${userStickerItem ? `[傳送貼圖：${userStickerItem.label}] ` : ''}${rawContent}`.trim();
    const botReadableTurn = `${botStickerItem ? `[傳送貼圖：${botStickerItem.label}] ` : ''}${aiResult.reply}`.trim();

    c.executionCtx.waitUntil(
      Promise.all([
        stateSvc.registerActiveUser(userId),
        stateSvc.savePetState(userId, nextState),
        stateSvc.appendHistory(userId, newTurns),
        stateSvc.appendDreamInbox(userId, [
          { role: 'user', content: userReadableTurn, ts: nowMs },
          { role: 'assistant', content: botReadableTurn, ts: nowMs + 1 },
        ]),
        memorySvc.addMemory(userId, [
          { role: 'user', content: userReadableTurn },
          { role: 'assistant', content: botReadableTurn },
        ]),
      ])
    );

    return c.json({
      reply: aiResult.reply,
      sticker: botStickerPayload,
      action: { emotion: aiResult.emotion },
      pet_state: nextState,
      meta: aiResult.meta,
    });
  } finally {
    await stateSvc.releaseLock(userId);
  }
}
