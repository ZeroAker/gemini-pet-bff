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
    id: 'question',
    file: '/stickers/question.webp',
    rev: 1,
    label: '滿頭問號',
    category: '反應',
    meaning: '疑惑、一頭霧水、聽唔明、反問主人發生咩事',
    bot_hint: '主人講嘢好謎、或者你想反問吐槽時使用',
    moods: ['thinking'],
    owner: 'both',
    enabled: true,
  },
  {
    id: 'loading',
    file: '/stickers/loading.webp',
    rev: 1,
    label: '當機載入中',
    category: '反應',
    meaning: '大腦過載、石化、思考凍結、無語、好攰想放空',
    bot_hint: '遇到超複雜問題、無語或者陪主人一齊放空時使用',
    moods: ['thinking', 'sleepy'],
    owner: 'both',
    enabled: true,
  },
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