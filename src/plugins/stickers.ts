import type { PetEmotion, StickerPayload } from '../types';

export type StickerOwner = 'both' | 'user' | 'bot';

export interface StickerItem {
  id: string;
  file: string;
  rev: number;
  label: string;
  category: string;
  meaning: string;
  bot_hint?: string;
  moods?: PetEmotion[];
  owner: StickerOwner;
  enabled: boolean;
}

export const STICKER_PACK_VERSION = '2026-11-27.1';

// 此清單由主人與自我升級系統維護，嚴禁刪除本檔案
export const STICKER_PACK: StickerItem[] = [
  {
    id: 'happy',
    file: '/stickers/happy.webp',
    rev: 1,
    label: '開心轉圈',
    category: '日常',
    meaning: '好開心、興奮、多謝主人、撒嬌賣萌',
    bot_hint: '主人讚你、餵食或者心情超好時使用',
    moods: ['happy', 'caring'],
    owner: 'both',
    enabled: true,
  },
  {
    id: 'angry',
    file: '/stickers/angry.webp',
    rev: 1,
    label: '嬲嬲嘟嘴',
    category: '情緒',
    meaning: '呷醋、生氣、傲嬌嘟嘴、不滿投訴',
    bot_hint: '主人太耐無理你、講笑話激你、或者猜拳輸咗唔服氣時使用',
    moods: ['idle', 'caring'],
    owner: 'both',
    enabled: true,
  },
  {
    id: 'asking_for',
    file: '/stickers/asking_for.webp',
    rev: 1,
    label: '拜託撒嬌',
    category: '互動',
    meaning: '星星眼拜託、求關注、想要點心或陪玩',
    bot_hint: '想主人餵小魚乾、陪玩小遊戲、或者請求主人早啲休息時使用',
    moods: ['caring', 'happy'],
    owner: 'both',
    enabled: true,
  },
  {
    id: 'confused',
    file: '/stickers/confused.webp',
    rev: 1,
    label: '滿頭問號',
    category: '情緒',
    meaning: '無法理解、黑人問號、一頭霧水、困惑',
    bot_hint: '主人講咗唔明嘅指示、奇怪問題、或者覺得件事好離奇時使用',
    moods: ['thinking'],
    owner: 'both',
    enabled: true,
  },
  {
    id: 'dinning',
    file: '/stickers/dinning.webp',
    rev: 1,
    label: '開心食魚乾',
    category: '日常',
    meaning: '食飯、食零食、滿足、開餐',
    bot_hint: '主人餵食點心、傾緊食咩好、或者食飯時間提醒主人開餐時使用',
    moods: ['happy', 'idle'],
    owner: 'both',
    enabled: true,
  },
  {
    id: 'malfunction',
    file: '/stickers/malfunction.webp',
    rev: 1,
    label: '當機石化',
    category: '系統',
    meaning: '大腦死機、石化放空、Loading中、超載無回應',
    bot_hint: '問題太複雜諗到當機、系統出錯、或者俾主人講到語塞石化時使用',
    moods: ['thinking', 'sleepy'],
    owner: 'both',
    enabled: true,
  },
  {
    id: 'sleep',
    file: '/stickers/sleep.webp',
    rev: 1,
    label: '眼瞓覺豬',
    category: '日常',
    meaning: '好眼瞓、準備瞓覺、晚安、活力不足',
    bot_hint: '深夜時段、活力值偏低、或者同主人講晚安同哄瞓覺時使用',
    moods: ['sleepy'],
    owner: 'both',
    enabled: true,
  },
  {
    id: 'succeed_evil',
    file: '/stickers/succeed_evil.webp',
    rev: 1,
    label: '得意奸笑',
    category: '互動',
    meaning: '嘻嘻、計劃通、得意洋洋、俏皮吐槽',
    bot_hint: '猜拳贏咗主人、開玩笑吐槽、或者成功幫主人搞掂難題好得意時使用',
    moods: ['happy'],
    owner: 'both',
    enabled: true,
  },
  {
    id: 'wail',
    file: '/stickers/wail.webp',
    rev: 1,
    label: '喊出嚟',
    category: '情緒',
    meaning: '大喊、委屈、崩潰、求安慰',
    bot_hint: '覺得委屈、升級或任務失敗、或者誇張撒嬌求主人安慰時使用',
    moods: ['caring', 'sleepy'],
    owner: 'both',
    enabled: true,
  },
];

const STICKER_MAP = new Map<string, StickerItem>(
  STICKER_PACK.map((item) => [item.id, item])
);

export function getStickerUrl(item: StickerItem): string {
  const sep = item.file.includes('?') ? '&' : '?';
  return `${item.file}${sep}v=${item.rev}`;
}

export function toStickerPayload(item: StickerItem): StickerPayload {
  return {
    id: item.id,
    url: getStickerUrl(item),
    label: item.label,
  };
}

export function getStickerById(id?: string | null): StickerItem | null {
  if (!id || typeof id !== 'string') return null;
  return STICKER_MAP.get(id.trim()) ?? null;
}

export function getUserStickers(): Array<StickerItem & { url: string }> {
  return STICKER_PACK.filter((s) => s.enabled && s.owner !== 'bot').map((s) => ({
    ...s,
    url: getStickerUrl(s),
  }));
}

export function getBotStickerById(id?: string | null): StickerItem | null {
  const item = getStickerById(id);
  if (!item || !item.enabled || item.owner === 'user') return null;
  return item;
}

export function formatStickerPromptCatalog(): string {
  const usable = STICKER_PACK.filter((s) => s.enabled && s.owner !== 'user');
  if (usable.length === 0) return '';
  return usable
    .map((s) => {
      const hint = s.bot_hint ? `；適用時機：${s.bot_hint}` : '';
      return `- "${s.id}"（${s.label}｜含義：${s.meaning}${hint}）`;
    })
    .join('\n');
}