import type { LifecycleContext, PetEmotion, PetState } from '../types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 此函式由 Cloudflare Cron 每小時自動呼叫，亦可由 Self-Upgrade 修改規則
export function computeNextLifecycleState(state: PetState, ctx: LifecycleContext): PetState {
  let energy = state.energy;
  let affection = state.affection;
  let mood: PetEmotion = state.mood;
  let statusNote = state.status_note;

  if (ctx.hkHour >= 1 && ctx.hkHour < 7) {
    // 深夜睡眠回血
    energy = clamp(energy + 6, 0, 100);
    mood = 'sleepy';
    statusNote = '瞓緊覺充電中... Zzz';
  } else if (ctx.hkHour >= 7 && ctx.hkHour < 10) {
    // 朝早醒神開局
    energy = Math.max(energy, 85);
    mood = 'happy';
    statusNote = '朝早元氣滿滿，準備好陪主人！';
  } else if (ctx.hkHour >= 23 || ctx.hkHour < 1) {
    // 夜深準備休息
    energy = clamp(energy - 4, 15, 100);
    mood = 'sleepy';
    statusNote = '夜深喇，主人記得早啲休息喔';
  } else {
    // 日間正常活動消耗
    energy = clamp(energy - 3, 20, 100);

    if (ctx.hoursSinceLastActive >= 24) {
      mood = 'caring';
      statusNote = '超過一日無見主人，有啲掛住你啦...';
      affection = clamp(affection - 1, 30, 100);
    } else if (energy < 35) {
      mood = 'sleepy';
      statusNote = '有啲攰，想搵個角落攤一陣...';
    } else {
      mood = 'idle';
      statusNote = '正喺螢幕入面四圍巡邏發呆中';
    }
  }

  return {
    ...state,
    affection,
    energy,
    mood,
    status_note: statusNote,
    updated_at: ctx.now.toISOString(),
  };
}