import type { PluginTool } from '../types';

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

export interface CareLogEntry {
  id: string;
  type: 'feed' | 'game';
  itemOrGame: string;
  energyDelta: number;
  affectionDelta: number;
  energyAfter: number;
  affectionAfter: number;
  summary: string;
  timestamp: string;
}

export interface PetCareStore {
  userId: string;
  energy: number;
  affection: number;
  mood: string;
  totalFedCount: number;
  totalGamesPlayed: number;
  lastFedAt: string | null;
  lastGameAt: string | null;
  updatedAt: string;
  history: CareLogEntry[];
}

interface KvNamespaceLike {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<unknown>;
}

interface CacheLike {
  match: (request: Request | string) => Promise<Response | undefined>;
  put: (request: Request | string, response: Response) => Promise<void>;
}

const CARE_MEMORY_STORE = new Map<string, PetCareStore>();

const SNACK_CATALOG: Record<SnackId, SnackSpec> = {
  dried_fish: {
    id: 'dried_fish',
    name: '香烤小魚乾',
    emoji: '🐟',
    energyGain: 15,
    affectionGain: 3,
    cooldownSec: 15,
    flavorText: '咔滋咔滋！鹹香酥脆的小魚乾讓桌寵開心地搖起尾巴～',
  },
  strawberry_cake: {
    id: 'strawberry_cake',
    name: '草莓鮮奶油蛋糕',
    emoji: '🍰',
    energyGain: 25,
    affectionGain: 5,
    cooldownSec: 25,
    flavorText: '酸甜多汁的草莓配綿密奶油，桌寵幸福得眼睛都變成星星了！',
  },
  special_coffee: {
    id: 'special_coffee',
    name: '星光特調咖啡',
    emoji: '☕',
    energyGain: 35,
    affectionGain: 4,
    cooldownSec: 30,
    flavorText: '溫潤回甘的特調香氣撲鼻而來，桌寵瞬間充滿百分之百的幹勁！',
  },
};

const GAME_COOLDOWN_SEC = 10;

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

function isKvLike(candidate: unknown): candidate is KvNamespaceLike {
  if (!candidate || typeof candidate !== 'object') return false;
  const rec = candidate as Record<string, unknown>;
  return typeof rec.get === 'function' && typeof rec.put === 'function';
}

function extractKvFromContext(ctx: { userId: string }): KvNamespaceLike | null {
  const raw = ctx as unknown as Record<string, unknown>;
  const directCandidates = [raw.kv, raw.store, raw.PET_KV, raw.KV];
  for (const item of directCandidates) {
    if (isKvLike(item)) return item;
  }
  if (raw.env && typeof raw.env === 'object') {
    const envRec = raw.env as Record<string, unknown>;
    for (const val of Object.values(envRec)) {
      if (isKvLike(val)) return val;
    }
  }
  return null;
}

function getWorkersCache(): CacheLike | null {
  const g = globalThis as unknown as {
    caches?: { default?: CacheLike };
  };
  if (g.caches && g.caches.default) {
    return g.caches.default;
  }
  return null;
}

function buildStorageKey(userId: string): string {
  return `pet_care_game_v1:${userId || 'default'}`;
}

function buildCacheUrl(userId: string): string {
  return `https://pet-care-store.internal/v1/${encodeURIComponent(userId || 'default')}`;
}

function deriveMood(energy: number, affection: number): string {
  if (energy >= 80 && affection >= 80) return '元氣滿滿・超級撒嬌';
  if (energy >= 70) return '活力充沛・心情愉快';
  if (energy >= 40) return '悠閒放鬆・期待互動';
  if (energy >= 20) return '肚子微餓・想吃點心';
  return '昏昏欲睡・急需補充能量';
}

function createInitialCareStore(userId: string): PetCareStore {
  const nowIso = new Date().toISOString();
  return {
    userId,
    energy: 75,
    affection: 60,
    mood: deriveMood(75, 60),
    totalFedCount: 0,
    totalGamesPlayed: 0,
    lastFedAt: null,
    lastGameAt: null,
    updatedAt: nowIso,
    history: [],
  };
}

function sanitizeCareStore(raw: unknown, userId: string): PetCareStore {
  if (!raw || typeof raw !== 'object') {
    return createInitialCareStore(userId);
  }
  const obj = raw as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const energy = clampStat(asNumberOrFallback(obj.energy, 75));
  const affection = clampStat(asNumberOrFallback(obj.affection, 60));
  const rawHistory = Array.isArray(obj.history) ? obj.history : [];
  const history: CareLogEntry[] = [];

  for (const item of rawHistory.slice(-20)) {
    if (!item || typeof item !== 'object') continue;
    const h = item as Record<string, unknown>;
    const entryType = asTrimmedString(h.type) === 'game' ? 'game' : 'feed';
    history.push({
      id: asTrimmedString(h.id) || crypto.randomUUID().slice(0, 8),
      type: entryType,
      itemOrGame: asTrimmedString(h.itemOrGame) || '互動',
      energyDelta: Math.round(asNumberOrFallback(h.energyDelta, 0)),
      affectionDelta: Math.round(asNumberOrFallback(h.affectionDelta, 0)),
      energyAfter: clampStat(asNumberOrFallback(h.energyAfter, energy)),
      affectionAfter: clampStat(asNumberOrFallback(h.affectionAfter, affection)),
      summary: asTrimmedString(h.summary) || '',
      timestamp: asTrimmedString(h.timestamp) || nowIso,
    });
  }

  return {
    userId: asTrimmedString(obj.userId) || userId,
    energy,
    affection,
    mood: asTrimmedString(obj.mood) || deriveMood(energy, affection),
    totalFedCount: Math.max(0, Math.round(asNumberOrFallback(obj.totalFedCount, 0))),
    totalGamesPlayed: Math.max(0, Math.round(asNumberOrFallback(obj.totalGamesPlayed, 0))),
    lastFedAt: asTrimmedString(obj.lastFedAt) || null,
    lastGameAt: asTrimmedString(obj.lastGameAt) || null,
    updatedAt: asTrimmedString(obj.updatedAt) || nowIso,
    history,
  };
}

async function loadCareStore(userId: string, ctx: { userId: string }): Promise<PetCareStore> {
  const key = buildStorageKey(userId);
  const kv = extractKvFromContext(ctx);
  if (kv) {
    try {
      const rawText = await kv.get(key);
      if (rawText) {
        const parsed = sanitizeCareStore(JSON.parse(rawText), userId);
        CARE_MEMORY_STORE.set(userId, parsed);
        return parsed;
      }
    } catch {
      // fallback to cache or memory
    }
  }

  const cache = getWorkersCache();
  if (cache) {
    try {
      const cachedRes = await cache.match(buildCacheUrl(userId));
      if (cachedRes) {
        const rawText = await cachedRes.text();
        const parsed = sanitizeCareStore(JSON.parse(rawText), userId);
        CARE_MEMORY_STORE.set(userId, parsed);
        return parsed;
      }
    } catch {
      // fallback to memory
    }
  }

  const existing = CARE_MEMORY_STORE.get(userId);
  if (existing) {
    return existing;
  }

  const initial = createInitialCareStore(userId);
  await saveCareStore(initial, ctx);
  return initial;
}

async function saveCareStore(store: PetCareStore, ctx: { userId: string }): Promise<void> {
  store.mood = deriveMood(store.energy, store.affection);
  store.updatedAt = new Date().toISOString();
  store.history = store.history.slice(-20);
  CARE_MEMORY_STORE.set(store.userId, store);
  const serialized = JSON.stringify(store);

  const cache = getWorkersCache();
  if (cache) {
    try {
      const res = new Response(serialized, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=31536000',
        },
      });
      await cache.put(buildCacheUrl(store.userId), res);
    } catch {
      // ignore cache failure
    }
  }

  const kv = extractKvFromContext(ctx);
  if (kv) {
    try {
      await kv.put(buildStorageKey(store.userId), serialized);
    } catch {
      // ignore kv failure
    }
  }
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
    description:
      '管理桌寵的餵食點心與互動小遊戲狀態。支援查詢目前活力值(0-100)、好感度与互動紀錄(status)、餵食點心如小魚乾/草莓蛋糕/特調咖啡(feed)、以及結算猜拳大作戰或點擊接愛心小遊戲(play_game)以補充桌寵活力與好感度。',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: '操作類型：status（查詢活力與紀錄）| feed（餵食點心）| play_game（進行或結算小遊戲）',
        },
        snack_id: {
          type: 'STRING',
          description: '餵食點心類型（用於 feed）：dried_fish（香烤小魚乾）、strawberry_cake（草莓鮮奶油蛋糕）、special_coffee（星光特調咖啡）',
        },
        game_type: {
          type: 'STRING',
          description: '小遊戲類型（用於 play_game）：rps（猜拳大作戰）| catch_hearts（點擊接愛心）',
        },
        player_choice: {
          type: 'STRING',
          description: '猜拳時主人的出拳（選填，用於 rps）：rock（石頭）| paper（布）| scissors（剪刀）',
        },
        game_result: {
          type: 'STRING',
          description: '前端小遊戲結算結果（選填）：win | draw | lose',
        },
        score: {
          type: 'STRING',
          description: '小遊戲得分或接到的愛心數量（選填，正整數字串，例如 "12"）',
        },
        sync_energy: {
          type: 'STRING',
          description: '選填，若前端已有最新活力值(0-100)可傳入進行同步校準。',
        },
        sync_affection: {
          type: 'STRING',
          description: '選填，若前端已有最新好感度(0-100)可傳入進行同步校準。',
        },
      },
      required: ['action'],
    },
  },
  async execute(args: Record<string, unknown>, ctx: { userId: string }): Promise<Record<string, unknown>> {
    const userId = asTrimmedString(ctx?.userId) || 'default_user';
    const action = asTrimmedString(args.action).toLowerCase() || 'status';

    if (!['status', 'feed', 'play_game'].includes(action)) {
      return {
        ok: false,
        error: '無效的 action 參數，請使用 status、feed 或 play_game。',
      };
    }

    const store = await loadCareStore(userId, ctx);
    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();

    if (args.sync_energy !== undefined && args.sync_energy !== '') {
      store.energy = clampStat(asNumberOrFallback(args.sync_energy, store.energy));
    }
    if (args.sync_affection !== undefined && args.sync_affection !== '') {
      store.affection = clampStat(asNumberOrFallback(args.sync_affection, store.affection));
    }

    if (action === 'status') {
      await saveCareStore(store, ctx);
      return {
        ok: true,
        action: 'status',
        pet_care: {
          energy: store.energy,
          affection: store.affection,
          mood: store.mood,
          totalFedCount: store.totalFedCount,
          totalGamesPlayed: store.totalGamesPlayed,
          lastFedAt: store.lastFedAt,
          lastGameAt: store.lastGameAt,
          availableSnacks: Object.values(SNACK_CATALOG),
          recentHistory: store.history.slice(-8),
        },
      };
    }

    if (action === 'feed') {
      const rawSnack = asTrimmedString(args.snack_id ?? args.snack ?? 'dried_fish');
      const snackId = resolveSnackId(rawSnack);
      const snack = SNACK_CATALOG[snackId];
      const remainCd = getRemainingCooldownSec(store.lastFedAt, snack.cooldownSec, nowMs);

      if (remainCd > 0) {
        return {
          ok: true,
          action: 'feed',
          onCooldown: true,
          remainingCooldownSec: remainCd,
          snack,
          message: `桌寵剛吃完點心還在細細品嚐中～再過 ${remainCd} 秒就可以再餵食囉！`,
          pet_care: {
            energy: store.energy,
            affection: store.affection,
            mood: store.mood,
          },
        };
      }

      const beforeEnergy = store.energy;
      const beforeAffection = store.affection;
      const wasFull = beforeEnergy >= 100;

      store.energy = clampStat(beforeEnergy + snack.energyGain);
      store.affection = clampStat(beforeAffection + snack.affectionGain);
      store.totalFedCount += 1;
      store.lastFedAt = nowIso;

      const actualEnergyDelta = store.energy - beforeEnergy;
      const actualAffectionDelta = store.affection - beforeAffection;

      const summary = wasFull
        ? `餵食了${snack.emoji}${snack.name}（活力已滿 100，好感度 +${actualAffectionDelta}）`
        : `餵食了${snack.emoji}${snack.name}（活力 +${actualEnergyDelta} → ${store.energy}，好感度 +${actualAffectionDelta} → ${store.affection}）`;

      const entry: CareLogEntry = {
        id: `feed-${crypto.randomUUID().slice(0, 8)}`,
        type: 'feed',
        itemOrGame: `${snack.emoji} ${snack.name}`,
        energyDelta: actualEnergyDelta,
        affectionDelta: actualAffectionDelta,
        energyAfter: store.energy,
        affectionAfter: store.affection,
        summary,
        timestamp: nowIso,
      };
      store.history.push(entry);
      await saveCareStore(store, ctx);

      return {
        ok: true,
        action: 'feed',
        onCooldown: false,
        snack,
        flavorText: snack.flavorText,
        summary,
        pet_care: {
          energy: store.energy,
          affection: store.affection,
          mood: store.mood,
          totalFedCount: store.totalFedCount,
          lastFedAt: store.lastFedAt,
        },
      };
    }

    // action === 'play_game'
    const rawGame = asTrimmedString(args.game_type ?? args.game ?? 'rps');
    const gameType = resolveGameType(rawGame);
    const remainGameCd = getRemainingCooldownSec(store.lastGameAt, GAME_COOLDOWN_SEC, nowMs);

    if (remainGameCd > 0) {
      return {
        ok: true,
        action: 'play_game',
        onCooldown: true,
        remainingCooldownSec: remainGameCd,
        gameType,
        message: `桌寵剛跑跳完正在喘口氣～再過 ${remainGameCd} 秒就可以再玩一場囉！`,
        pet_care: {
          energy: store.energy,
          affection: store.affection,
          mood: store.mood,
        },
      };
    }

    const beforeEnergy = store.energy;
    const beforeAffection = store.affection;
    let energyReward = 10;
    let affectionReward = 3;
    let detailText = '';
    let gameTitle = '';

    if (gameType === 'rps') {
      gameTitle = '✊✌️🖐️ 猜拳大作戰';
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
      const rawScore = Math.max(1, Math.min(50, Math.round(asNumberOrFallback(args.score, 10))));
      energyReward = Math.min(30, Math.max(8, Math.round(rawScore * 2)));
      affectionReward = Math.min(8, Math.max(2, Math.ceil(rawScore / 3)));
      detailText = `主人在限時挑戰中接到了 ${rawScore} 顆愛心！滿滿的心意讓桌寵活力大爆發！`;
    }

    store.energy = clampStat(beforeEnergy + energyReward);
    store.affection = clampStat(beforeAffection + affectionReward);
    store.totalGamesPlayed += 1;
    store.lastGameAt = nowIso;

    const actualEnergyDelta = store.energy - beforeEnergy;
    const actualAffectionDelta = store.affection - beforeAffection;
    const summary = `遊玩「${gameTitle}」（活力 +${actualEnergyDelta} → ${store.energy}，好感度 +${actualAffectionDelta} → ${store.affection}）`;

    const entry: CareLogEntry = {
      id: `game-${crypto.randomUUID().slice(0, 8)}`,
      type: 'game',
      itemOrGame: gameTitle,
      energyDelta: actualEnergyDelta,
      affectionDelta: actualAffectionDelta,
      energyAfter: store.energy,
      affectionAfter: store.affection,
      summary,
      timestamp: nowIso,
    };
    store.history.push(entry);
    await saveCareStore(store, ctx);

    return {
      ok: true,
      action: 'play_game',
      onCooldown: false,
      gameType,
      gameTitle,
      detailText,
      summary,
      pet_care: {
        energy: store.energy,
        affection: store.affection,
        mood: store.mood,
        totalGamesPlayed: store.totalGamesPlayed,
        lastGameAt: store.lastGameAt,
      },
    };
  },
};
