import type { LifecycleContext, PetEmotion, PetState } from '../types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isHongKongWeekend(now: Date): boolean {
  try {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Hong_Kong',
      weekday: 'short',
    }).format(now);
    return weekday === 'Sat' || weekday === 'Sun';
  } catch {
    const hkDay = new Date(now.getTime() + 8 * 3_600_000).getUTCDay();
    return hkDay === 0 || hkDay === 6;
  }
}

function computeBoredom(prevExtra: Record<string, unknown>, hoursSinceLastActive: number): number {
  if (hoursSinceLastActive < 1) {
    return 0;
  }
  const rawPrev = prevExtra.boredom;
  const prevBoredom =
    typeof rawPrev === 'number' && Number.isFinite(rawPrev)
      ? clamp(Math.round(rawPrev), 0, 100)
      : 0;
  return clamp(prevBoredom + 8, 0, 100);
}

function resolveActivity(
  hkHour: number,
  isWeekend: boolean,
  energy: number,
  boredom: number,
  hoursSinceLastActive: number
): string {
  if (hkHour >= 1 && hkHour < 7) {
    return isWeekend ? '抱住小魚乾抱枕熟睡中 💤' : '蜷縮喺軟墊上面發緊美夢 💤';
  }

  if (isWeekend && hkHour >= 7 && hkHour < 10) {
    return '喺被窩入面翻身繼續賴床 🛌';
  }

  if ((!isWeekend && hkHour >= 7 && hkHour < 10) || (isWeekend && hkHour >= 10 && hkHour < 12)) {
    return boredom >= 40 ? '伸懶腰中，順便抓下貓抓板 🐾' : '伸懶腰中，元氣滿滿同主人揮手 ☀️';
  }

  if (hkHour >= 23 || hkHour < 1) {
    return '打緊呵欠、拍鬆枕頭準備瞓覺 🌙';
  }

  if (energy < 35) {
    return '趴喺鍵盤上面瞇眼抖緊氣 😪';
  }

  if (hoursSinceLastActive < 1 || boredom === 0) {
    return isWeekend ? '開心地圍住主人轉圈撒嬌 ✨' : '搖住尾巴開心地陪喺主人身邊 ✨';
  }

  if (boredom >= 80) {
    return '追緊雷射筆紅點狂奔解悶 🔴';
  }

  if (boredom >= 50) {
    return '趴喺鍵盤上面偷睇主人做緊咩 👀';
  }

  if (boredom >= 24) {
    return '追緊雷射筆、自己撲蝶仔玩 🦋';
  }

  if (!isWeekend && hkHour >= 10 && hkHour < 18) {
    return '乖巧坐喺螢幕旁邊陪主人專心辦公 💻';
  }

  if (isWeekend) {
    return '喺窗邊曬太陽、晃住尾巴嘆世界 🌤️';
  }

  return '伸懶腰中，喺桌面四圍巡邏 🐾';
}

// 此函式由 Cloudflare Cron 每小時自動呼叫，亦可由 Self-Upgrade 修改規則
export function computeNextLifecycleState(state: PetState, ctx: LifecycleContext): PetState {
  let energy = state.energy;
  let affection = state.affection;
  let mood: PetEmotion = state.mood;
  let statusNote = state.status_note;

  const isWeekend = isHongKongWeekend(ctx.now);
  const prevExtra = state.extra && typeof state.extra === 'object' ? state.extra : {};
  const boredom = computeBoredom(prevExtra, ctx.hoursSinceLastActive);

  if (ctx.hkHour >= 1 && ctx.hkHour < 7) {
    // 深夜睡眠回血
    energy = clamp(energy + 6, 0, 100);
    mood = 'sleepy';
    statusNote = isWeekend
      ? '週末深夜安心熟睡充電中... Zzz'
      : '平日深夜瞓緊覺充電中，聽日繼續陪主人搏殺... Zzz';
  } else if (isWeekend && ctx.hkHour >= 7 && ctx.hkHour < 10) {
    // 週末早上多睡一會才醒
    energy = clamp(Math.max(energy + 6, 80), 0, 100);
    mood = 'sleepy';
    statusNote = '週末朝早多瞓一陣先醒... 主人放假都唔好咁早起身啦 Zzz';
  } else if ((!isWeekend && ctx.hkHour >= 7 && ctx.hkHour < 10) || (isWeekend && ctx.hkHour >= 10 && ctx.hkHour < 12)) {
    // 朝早醒神開局（平日 07:00-09:59，週末 10:00-11:59）
    energy = Math.max(energy, isWeekend ? 90 : 85);
    mood = 'happy';
    statusNote = isWeekend
      ? '週末瞓飽自然醒！今日放假心情超靚，同主人一齊輕鬆嘆世界～'
      : '平日朝早元氣滿滿，幫主人加油打氣，今日返工順順利利！';
  } else if (ctx.hkHour >= 23 || ctx.hkHour < 1) {
    // 夜深準備休息
    energy = clamp(energy - 4, 15, 100);
    mood = 'sleepy';
    statusNote = isWeekend
      ? '週末夜深喇，嘆完假期記得早啲休息叉電喔'
      : '平日夜深喇，主人聽日仲要早起，記得早啲休息喔';
  } else {
    // 日間與晚間正常活動消耗（若剛互動完則不重複扣減活力）
    const energyDelta = ctx.hoursSinceLastActive < 0.05 ? 0 : -3;
    energy = clamp(energy + energyDelta, 20, 100);

    if (ctx.hoursSinceLastActive >= 24) {
      mood = 'caring';
      statusNote = isWeekend
        ? '週末成日無見主人，有啲掛住你啦，得閒快啲搵我傾計喔...'
        : '超過一日無見主人，平日再忙都要記得照顧自己呀...';
      affection = clamp(affection - 1, 30, 100);
    } else if (energy < 35) {
      mood = 'sleepy';
      statusNote = isWeekend
        ? '週末玩到有啲攰，想搵個角落攤一陣...'
        : '陪主人忙咗半日有啲攰，想搵個角落攤一陣...';
    } else if (boredom >= 64) {
      mood = 'caring';
      statusNote = isWeekend
        ? '週末自己一個有啲悶悶地，主人快啲過嚟陪我玩啦～'
        : '主人忙咗好耐無理我，做完手頭工作記得摸下我喔～';
    } else if (!isWeekend && ctx.hkHour >= 10 && ctx.hkHour < 18) {
      // 平日上班時段幫主人打氣
      mood = 'happy';
      statusNote = '平日上班時段幫主人打氣加油！專注衝刺之餘記得飲水抖一抖 💪';
    } else if (!isWeekend && ctx.hkHour >= 18 && ctx.hkHour < 23) {
      // 平日放工時段
      mood = 'caring';
      statusNote = '平日收工時間到！辛苦晒主人，快啲放鬆心情抖下啦 ✨';
    } else {
      // 週末日間與晚間休閒時段
      mood = 'happy';
      statusNote = '週末悠閒放假時光，正開心地喺螢幕入面陪住主人！';
    }
  }

  const activity = resolveActivity(ctx.hkHour, isWeekend, energy, boredom, ctx.hoursSinceLastActive);

  return {
    ...state,
    affection,
    energy,
    mood,
    status_note: statusNote,
    updated_at: ctx.now.toISOString(),
    extra: {
      ...prevExtra,
      boredom,
      activity,
    },
  };
}
