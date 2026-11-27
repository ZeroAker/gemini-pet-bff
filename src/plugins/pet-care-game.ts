import type { CareLogEntry, PetState, PluginContext, PluginTool } from '../types';

export type SnackId = 'dried_fish' | 'strawberry_cake' | 'special_coffee';
export type GameType = 'rps' | 'catch_hearts';
export type RpsChoice = 'rock' | 'paper' | 'scissors';

export interface SnackSpec {
  id: SnackId;
  name: string;
  emoji: string;
  energyGain: number;
  affectionGain: number;
  cooldownSec: number;
  flavorText: string;
}

const SNACK_CATALOG: Record<SnackId, SnackSpec> = {
  dried_fish: {
    id: 'dried_fish',
    name: '香烤小魚乾',
    emoji: '🐟',
    energyGain: 15,
    affectionGain: 3,
    cooldownSec: 5,
    flavorText: '咔滋咔滋！鹹香酥脆的小魚乾讓桌寵開心地搖起尾巴～',
  },
  strawberry_cake: {
    id: 'strawberry_cake',
    name: '草莓鮮奶油蛋糕',
    emoji: '🍰',
    energyGain: 25,
    affectionGain: 5,
    cooldownSec: 8,
    flavorText: '酸甜多汁的草莓配綿密奶油，桌寵幸福得眼睛都變成星星了！',
  },
  special_coffee: {
    id: 'special_coffee',
    name: '星光特調咖啡',
    emoji: '☕',
    energyGain: 35,
    affectionGain: 4,
    cooldownSec: 10,
    flavorText: '溫潤回甘的特調香氣撲鼻而來，桌寵瞬間充滿百分之百的幹勁！',
  },
};

const GAME_COOLDOWN_SEC = 5;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampStat(val: number, min = 0, max = 100): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val)));
}

function asNumberOrFallback(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function deriveMoodLabel(energy: number, affection: number): string {
  if (energy >= 80 && affection >= 80) return '元氣滿滿・超級撒嬌';
  if (energy >= 70) return '活力充沛・心情愉快';
  if (energy >= 40) return '悠閒放鬆・期待互動';
  if (energy >= 20) return '肚子微餓・想吃點心';
  return '昏昏欲睡・急需補充能量';
}

function resolveSnackId(input: string): SnackId {
  const lower = input.toLowerCase();
  if (lower.includes('cake') || lower.includes('草莓') || lower.includes('蛋糕')) {
    return 'strawberry_cake';
  }
  if (lower.includes('coffee') || lower.includes('咖啡') || lower.includes('特調')) {
    return 'special_coffee';
  }
  return 'dried_fish';
}

function resolveGameType(input: string): GameType {
  const lower = input.toLowerCase();
  if (lower.includes('heart') || lower.includes('愛心') || lower.includes('catch')) {
    return 'catch_hearts';
  }
  return 'rps';
}

function normalizeRpsChoice(raw: string): RpsChoice {
  const lower = raw.toLowerCase();
  if (lower === 'paper' || lower.includes('布')) return 'paper';
  if (lower === 'scissors' || lower.includes('剪刀')) return 'scissors';
  return 'rock';
}

function getRemainingCooldownSec(lastIso: string | null, cooldownSec: number, nowMs: number): number {
  if (!lastIso) return 0;
  const lastMs = Date.parse(lastIso);
  if (!Number.isFinite(lastMs)) return 0;
  const elapsedSec = (nowMs - lastMs) / 1000;
  if (elapsedSec >= cooldownSec) return 0;
  return Math.max(1, Math.ceil(cooldownSec - elapsedSec));
}

export const petCareGamePlugin: PluginTool = {
  declaration: {
    name: 'manage_pet_care_game',
    description: '管理桌寵餵食與小遊戲並同步活力/好感度（status/feed/play_game）。',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'status | feed | play_game',
        },
        snack_id: {
          type: 'STRING',
          description: 'dried_fish | strawberry_cake | special_coffee（feed 用）',
        },
        game_type: {
          type: 'STRING',
          description: 'rps | catch_hearts（play_game 用）',
        },
        player_choice: {
          type: 'STRING',
          description: 'rock | paper | scissors（rps 選填）',
        },
        game_result: {
          type: 'STRING',
          description: 'win | draw | lose（選填）',
        },
        score: {
          type: 'STRING',
          description: '得分或愛心數（正整數字串，選填）',
        },
      },
      required: ['action'],
    },
  },
  async execute(args: Record<string, unknown>, ctx: PluginContext): Promise<Record<string, unknown>> {
    const userId = asTrimmedString(ctx?.userId) || 'zero_main';
    const stateSvc = ctx?.stateSvc;
    if (!stateSvc) {
      return { ok: false, error: '系統未注入 StateService，無法同步主狀態。' };
    }

    const action = asTrimmedString(args.action).toLowerCase() || 'status';
    if (!['status', 'feed', 'play_game'].includes(action)) {
      return { ok: false, error: '無效的 action 參數，請使用 status、feed 或 play_game。' };
    }

    const [mainState, careMeta] = await Promise.all([
      stateSvc.getPetState(userId),
      stateSvc.getCareMeta(userId),
    ]);

    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const prevExtra = mainState.extra && typeof mainState.extra === 'object' ? mainState.extra : {};

    if (action === 'status') {
      return {
        ok: true,
        action: 'status',
        pet_state: mainState,
        pet_care: {
          energy: mainState.energy,
          affection: mainState.affection,
          mood: deriveMoodLabel(mainState.energy, mainState.affection),
          totalFedCount: careMeta.totalFedCount,
          totalGamesPlayed: careMeta.totalGamesPlayed,
          lastFedAt: careMeta.lastFedAt,
          lastGameAt: careMeta.lastGameAt,
          availableSnacks: Object.values(SNACK_CATALOG),
          recentHistory: careMeta.history.slice(-8),
        },
      };
    }

    if (action === 'feed') {
      const rawSnack = asTrimmedString(args.snack_id ?? args.snack ?? 'dried_fish');
      const snackId = resolveSnackId(rawSnack);
      const snack = SNACK_CATALOG[snackId];
      const remainCd = getRemainingCooldownSec(careMeta.lastFedAt, snack.cooldownSec, nowMs);

      if (remainCd > 0) {
        return {
          ok: true,
          action: 'feed',
          onCooldown: true,
          remainingCooldownSec: remainCd,
          snack,
          message: `桌寵剛吃完點心還在細細品嚐中～再過 ${remainCd} 秒就可以再餵食囉！`,
          pet_state: mainState,
          pet_care: {
            energy: mainState.energy,
            affection: mainState.affection,
            mood: deriveMoodLabel(mainState.energy, mainState.affection),
          },
        };
      }

      const beforeEnergy = clampStat(mainState.energy);
      const beforeAffection = clampStat(mainState.affection);
      const nextEnergy = clampStat(beforeEnergy + snack.energyGain);
      const nextAffection = clampStat(beforeAffection + snack.affectionGain);
      const actualEnergyDelta = nextEnergy - beforeEnergy;
      const actualAffectionDelta = nextAffection - beforeAffection;

      const summary =
        beforeEnergy >= 100
          ? `餵食了${snack.emoji}${snack.name}（活力已滿 100，好感度 +${actualAffectionDelta}）`
          : `餵食了${snack.emoji}${snack.name}（活力 +${actualEnergyDelta} → ${nextEnergy}，好感度 +${actualAffectionDelta} → ${nextAffection}）`;

      const nextMainState: PetState = {
        ...mainState,
        energy: nextEnergy,
        affection: nextAffection,
        mood: 'happy',
        status_note: `食完${snack.name}，元氣滿滿！`,
        last_active_at: nowIso,
        updated_at: nowIso,
        extra: {
          ...prevExtra,
          boredom: 0,
          activity: `津津有味咁嘆緊${snack.name} ${snack.emoji}`,
        },
      };

      const entry: CareLogEntry = {
        id: `feed-${crypto.randomUUID().slice(0, 8)}`,
        type: 'feed',
        itemOrGame: `${snack.emoji} ${snack.name}`,
        energyDelta: actualEnergyDelta,
        affectionDelta: actualAffectionDelta,
        energyAfter: nextEnergy,
        affectionAfter: nextAffection,
        summary,
        timestamp: nowIso,
      };

      const nextCareMeta = {
        ...careMeta,
        totalFedCount: careMeta.totalFedCount + 1,
        lastFedAt: nowIso,
        history: [...careMeta.history, entry].slice(-20),
        updatedAt: nowIso,
      };

      await Promise.all([
        stateSvc.savePetState(userId, nextMainState),
        stateSvc.saveCareMeta(userId, nextCareMeta),
        stateSvc.registerActiveUser(userId),
      ]);

      return {
        ok: true,
        action: 'feed',
        onCooldown: false,
        snack,
        flavorText: snack.flavorText,
        summary,
        pet_state: nextMainState,
        pet_care: {
          energy: nextEnergy,
          affection: nextAffection,
          mood: deriveMoodLabel(nextEnergy, nextAffection),
          totalFedCount: nextCareMeta.totalFedCount,
          lastFedAt: nextCareMeta.lastFedAt,
        },
      };
    }

    // action === 'play_game'
    const rawGame = asTrimmedString(args.game_type ?? args.game ?? 'rps');
    const gameType = resolveGameType(rawGame);
    const remainGameCd = getRemainingCooldownSec(careMeta.lastGameAt, GAME_COOLDOWN_SEC, nowMs);

    if (remainGameCd > 0) {
      return {
        ok: true,
        action: 'play_game',
        onCooldown: true,
        remainingCooldownSec: remainGameCd,
        gameType,
        message: `桌寵剛跑跳完正在喘口氣～再過 ${remainGameCd} 秒就可以再玩一場囉！`,
        pet_state: mainState,
        pet_care: {
          energy: mainState.energy,
          affection: mainState.affection,
          mood: deriveMoodLabel(mainState.energy, mainState.affection),
        },
      };
    }

    const beforeEnergy = clampStat(mainState.energy);
    const beforeAffection = clampStat(mainState.affection);
    let energyReward = 10;
    let affectionReward = 3;
    let detailText = '';
    let gameTitle = '';
    let activityText = '同主人玩緊互動小遊戲，興奮搖尾巴 🎲';

    if (gameType === 'rps') {
      gameTitle = '✊✌️🖐️ 猜拳大作戰';
      activityText = '同主人玩緊猜拳大作戰，興奮搖尾巴 🎲';
      const explicitResult = asTrimmedString(args.game_result).toLowerCase();
      const choices: RpsChoice[] = ['rock', 'paper', 'scissors'];
      const labelMap: Record<RpsChoice, string> = {
        rock: '✊ 石頭',
        paper: '🖐️ 布',
        scissors: '✌️ 剪刀',
      };
      const playerChoice = normalizeRpsChoice(asTrimmedString(args.player_choice || 'rock'));
      const petChoice = choices[Math.floor(Math.random() * choices.length)] ?? 'scissors';

      let outcome: 'win' | 'draw' | 'lose' = 'draw';
      if (explicitResult === 'win' || explicitResult === 'draw' || explicitResult === 'lose') {
        outcome = explicitResult;
      } else if (playerChoice === petChoice) {
        outcome = 'draw';
      } else if (
        (playerChoice === 'rock' && petChoice === 'scissors') ||
        (playerChoice === 'paper' && petChoice === 'rock') ||
        (playerChoice === 'scissors' && petChoice === 'paper')
      ) {
        outcome = 'win';
      } else {
        outcome = 'lose';
      }

      if (outcome === 'win') {
        energyReward = 18;
        affectionReward = 5;
        detailText = `主人出「${labelMap[playerChoice]}」贏過了桌寵！桌寵雖然不服輸但玩得超興奮～`;
      } else if (outcome === 'draw') {
        energyReward = 12;
        affectionReward = 4;
        detailText = `雙方都出「${labelMap[playerChoice]}」平手！默契滿分讓桌寵笑咪咪～`;
      } else {
        energyReward = 14;
        affectionReward = 4;
        detailText = `桌寵出「${labelMap[petChoice]}」贏了這局！桌寵得意地轉圈圈，精神百倍！`;
      }
    } else {
      gameTitle = '💖 點擊接愛心挑戰';
      activityText = '蹦蹦跳跳接住滿滿愛心 💖';
      const rawScore = Math.max(0, Math.min(50, Math.round(asNumberOrFallback(args.score, 10))));
      energyReward = Math.min(30, Math.max(8, Math.round(rawScore * 2)));
      affectionReward = Math.min(8, Math.max(2, Math.ceil((rawScore || 1) / 3)));
      detailText = `主人在限時挑戰中接到了 ${rawScore} 顆愛心！滿滿的心意讓桌寵活力大爆發！`;
    }

    const nextEnergy = clampStat(beforeEnergy + energyReward);
    const nextAffection = clampStat(beforeAffection + affectionReward);
    const actualEnergyDelta = nextEnergy - beforeEnergy;
    const actualAffectionDelta = nextAffection - beforeAffection;
    const summary = `遊玩「${gameTitle}」（活力 +${actualEnergyDelta} → ${nextEnergy}，好感度 +${actualAffectionDelta} → ${nextAffection}）`;

    const nextMainState: PetState = {
      ...mainState,
      energy: nextEnergy,
      affection: nextAffection,
      mood: 'happy',
      status_note: `啱啱同主人玩完「${gameTitle}」，超開心！`,
      last_active_at: nowIso,
      updated_at: nowIso,
      extra: {
        ...prevExtra,
        boredom: 0,
        activity: activityText,
      },
    };

    const entry: CareLogEntry = {
      id: `game-${crypto.randomUUID().slice(0, 8)}`,
      type: 'game',
      itemOrGame: gameTitle,
      energyDelta: actualEnergyDelta,
      affectionDelta: actualAffectionDelta,
      energyAfter: nextEnergy,
      affectionAfter: nextAffection,
      summary,
      timestamp: nowIso,
    };

    const nextCareMeta = {
      ...careMeta,
      totalGamesPlayed: careMeta.totalGamesPlayed + 1,
      lastGameAt: nowIso,
      history: [...careMeta.history, entry].slice(-20),
      updatedAt: nowIso,
    };

    await Promise.all([
      stateSvc.savePetState(userId, nextMainState),
      stateSvc.saveCareMeta(userId, nextCareMeta),
      stateSvc.registerActiveUser(userId),
    ]);

    return {
      ok: true,
      action: 'play_game',
      onCooldown: false,
      gameType,
      gameTitle,
      detailText,
      summary,
      pet_state: nextMainState,
      pet_care: {
        energy: nextEnergy,
        affection: nextAffection,
        mood: deriveMoodLabel(nextEnergy, nextAffection),
        totalGamesPlayed: nextCareMeta.totalGamesPlayed,
        lastGameAt: nextCareMeta.lastGameAt,
      },
    };
  },
};