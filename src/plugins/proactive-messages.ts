import type { PluginTool } from '../types';

export type ScheduleType = 'daily' | 'interval' | 'idle';

export interface ProactiveRule {
  id: string;
  title: string;
  message: string;
  scheduleType: ScheduleType;
  time: string;
  intervalMinutes: number;
  enabled: boolean;
  aiGenerated: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
}

export interface ProactiveUserStore {
  userId: string;
  globalEnabled: boolean;
  timezone: string;
  lastInteractionAt: string;
  updatedAt: string;
  rules: ProactiveRule[];
}

interface KvNamespaceLike {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<unknown>;
}

interface CacheLike {
  match: (request: Request | string) => Promise<Response | undefined>;
  put: (request: Request | string, response: Response) => Promise<void>;
}

interface GeminiCandidatePart {
  text?: string;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiCandidatePart[];
  };
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
}

const MEMORY_STORE = new Map<string, ProactiveUserStore>();
const DEFAULT_TIMEZONE = 'Asia/Taipei';
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') return true;
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') return false;
  }
  return fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(10080, Math.round(value)));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(10080, Math.round(parsed)));
    }
  }
  return fallback;
}

function normalizeTime(raw: string, fallback = '09:00'): string {
  const match = TIME_PATTERN.exec(raw.trim());
  if (!match) return fallback;
  const hh = (match[1] ?? '09').padStart(2, '0');
  const mm = (match[2] ?? '00').padStart(2, '0');
  return `${hh}:${mm}`;
}

function normalizeScheduleType(
  raw: string,
  hasExplicitTime: boolean,
  hasExplicitInterval: boolean
): ScheduleType {
  const lower = raw.toLowerCase();
  if (lower === 'daily' || lower === 'interval' || lower === 'idle') {
    return lower;
  }
  if (hasExplicitTime && !hasExplicitInterval) return 'daily';
  if (hasExplicitInterval) return 'interval';
  return 'daily';
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

function extractGeminiApiKey(ctx: { userId: string }, args: Record<string, unknown>): string {
  const fromArgs = asTrimmedString(args.gemini_api_key ?? args.api_key);
  if (fromArgs) return fromArgs;

  const raw = ctx as unknown as Record<string, unknown>;
  const directKeys = [
    raw.geminiApiKey,
    raw.apiKey,
    raw.GEMINI_API_KEY,
    raw.GOOGLE_API_KEY,
  ];
  for (const candidate of directKeys) {
    const key = asTrimmedString(candidate);
    if (key) return key;
  }

  if (raw.env && typeof raw.env === 'object') {
    const envRec = raw.env as Record<string, unknown>;
    const envKeys = [
      envRec.GEMINI_API_KEY,
      envRec.GOOGLE_API_KEY,
      envRec.GEMINI_KEY,
      envRec.API_KEY,
    ];
    for (const candidate of envKeys) {
      const key = asTrimmedString(candidate);
      if (key) return key;
    }
  }

  const g = globalThis as unknown as Record<string, unknown>;
  const globalKey = asTrimmedString(g.GEMINI_API_KEY ?? g.GOOGLE_API_KEY);
  if (globalKey) return globalKey;

  return '';
}

async function generateAiCareSentence(
  rule: ProactiveRule,
  localTimeInfo: { dateStr: string; timeStr: string },
  ctx: { userId: string },
  args: Record<string, unknown>
): Promise<{ message: string; aiGeneratedSuccess: boolean }> {
  const fallbackMessage = rule.message || rule.title || '主人～記得休息一下喔！🐾';
  const apiKey = extractGeminiApiKey(ctx, args);
  if (!apiKey) {
    return { message: fallbackMessage, aiGeneratedSuccess: false };
  }

  const scheduleLabel =
    rule.scheduleType === 'daily'
      ? `每日定時 (${rule.time})`
      : rule.scheduleType === 'interval'
        ? `每 ${rule.intervalMinutes} 分鐘週期提醒`
        : `閒置滿 ${rule.intervalMinutes} 分鐘關懷`;

  const prompt = [
    '你是一隻溫暖、貼心、有活力的 AI 桌寵，正在主動關心主人。',
    `目前時間：${localTimeInfo.dateStr} ${localTimeInfo.timeStr}`,
    `關懷類型：${scheduleLabel}`,
    `主題標題：${rule.title}`,
    `參考提示或備用句子：${fallbackMessage}`,
    '請根據上述主題與參考提示，即時創作一句自然可愛、符合桌寵性格且不重複的繁體中文主動關懷句子（約 20～60 字，可搭配 1～2 個貼切 Emoji）。',
    '請直接輸出那句給主人的話，不要加上引號或任何額外說明。',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 150,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { message: fallbackMessage, aiGeneratedSuccess: false };
    }

    const data = (await res.json()) as GeminiGenerateContentResponse;
    const firstCandidate = Array.isArray(data.candidates) ? data.candidates[0] : undefined;
    const parts = firstCandidate?.content?.parts;
    const firstPart = Array.isArray(parts) ? parts[0] : undefined;
    const generatedText = asTrimmedString(firstPart?.text);

    if (generatedText.length > 0) {
      return { message: generatedText, aiGeneratedSuccess: true };
    }
    return { message: fallbackMessage, aiGeneratedSuccess: false };
  } catch {
    return { message: fallbackMessage, aiGeneratedSuccess: false };
  } finally {
    clearTimeout(timer);
  }
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
  return `pet_proactive_messages_v1:${userId || 'default'}`;
}

function buildCacheUrl(userId: string): string {
  return `https://proactive-store.internal/v1/${encodeURIComponent(userId || 'default')}`;
}

function createDefaultRules(nowIso: string): ProactiveRule[] {
  return [
    {
      id: 'daily-morning',
      title: '每日早安問候',
      message: '早安主人！新的一天開始囉，今天有什麼計畫想跟我分享嗎？☀️',
      scheduleType: 'daily',
      time: '09:00',
      intervalMinutes: 60,
      enabled: true,
      aiGenerated: false,
      createdAt: nowIso,
      lastTriggeredAt: null,
    },
    {
      id: 'idle-care',
      title: '閒置關懷提醒',
      message: '主人忙了好一陣子呢，記得站起來伸個懶腰、喝口水休息一下喔！🐾',
      scheduleType: 'idle',
      time: '00:00',
      intervalMinutes: 120,
      enabled: true,
      aiGenerated: false,
      createdAt: nowIso,
      lastTriggeredAt: null,
    },
  ];
}

function createInitialStore(userId: string): ProactiveUserStore {
  const nowIso = new Date().toISOString();
  return {
    userId,
    globalEnabled: true,
    timezone: DEFAULT_TIMEZONE,
    lastInteractionAt: nowIso,
    updatedAt: nowIso,
    rules: createDefaultRules(nowIso),
  };
}

function sanitizeStore(raw: unknown, userId: string): ProactiveUserStore {
  if (!raw || typeof raw !== 'object') {
    return createInitialStore(userId);
  }
  const obj = raw as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const rawRules = Array.isArray(obj.rules) ? obj.rules : [];
  const rules: ProactiveRule[] = [];

  for (const item of rawRules) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = asTrimmedString(r.id) || crypto.randomUUID().slice(0, 8);
    const scheduleType = normalizeScheduleType(asTrimmedString(r.scheduleType), true, false);
    const title = asTrimmedString(r.title) || '主動關懷提醒';
    const message = asTrimmedString(r.message) || title;
    const time = normalizeTime(asTrimmedString(r.time), '09:00');
    const intervalMinutes = asPositiveInt(r.intervalMinutes, 60);
    const enabled = asBoolean(r.enabled, true);
    const aiGenerated = asBoolean(r.aiGenerated ?? r.ai_generated, false);
    const createdAt = asTrimmedString(r.createdAt) || nowIso;
    const lastTriggeredAt = asTrimmedString(r.lastTriggeredAt) || null;
    rules.push({
      id,
      title,
      message,
      scheduleType,
      time,
      intervalMinutes,
      enabled,
      aiGenerated,
      createdAt,
      lastTriggeredAt,
    });
  }

  return {
    userId: asTrimmedString(obj.userId) || userId,
    globalEnabled: asBoolean(obj.globalEnabled, true),
    timezone: asTrimmedString(obj.timezone) || DEFAULT_TIMEZONE,
    lastInteractionAt: asTrimmedString(obj.lastInteractionAt) || nowIso,
    updatedAt: asTrimmedString(obj.updatedAt) || nowIso,
    rules,
  };
}

async function loadUserStore(userId: string, ctx: { userId: string }): Promise<ProactiveUserStore> {
  const key = buildStorageKey(userId);
  const kv = extractKvFromContext(ctx);
  if (kv) {
    try {
      const rawText = await kv.get(key);
      if (rawText) {
        const parsed = sanitizeStore(JSON.parse(rawText), userId);
        MEMORY_STORE.set(userId, parsed);
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
        const parsed = sanitizeStore(JSON.parse(rawText), userId);
        MEMORY_STORE.set(userId, parsed);
        return parsed;
      }
    } catch {
      // fallback to memory
    }
  }

  const existing = MEMORY_STORE.get(userId);
  if (existing) {
    return existing;
  }

  const initial = createInitialStore(userId);
  await saveUserStore(initial, ctx);
  return initial;
}

async function saveUserStore(store: ProactiveUserStore, ctx: { userId: string }): Promise<void> {
  store.updatedAt = new Date().toISOString();
  MEMORY_STORE.set(store.userId, store);
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
      // ignore cache write failure
    }
  }

  const kv = extractKvFromContext(ctx);
  if (kv) {
    try {
      await kv.put(buildStorageKey(store.userId), serialized);
    } catch {
      // ignore kv write failure
    }
  }
}

function getZonedDateTime(date: Date, timeZone: string): { dateStr: string; timeStr: string; minutesOfDay: number } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = p.value;
    }
  }
  const year = map.year ?? '1970';
  const month = (map.month ?? '01').padStart(2, '0');
  const day = (map.day ?? '01').padStart(2, '0');
  const rawHour = Number(map.hour ?? '0');
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(map.minute ?? '0');

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return {
    dateStr: `${year}-${month}-${day}`,
    timeStr: `${hh}:${mm}`,
    minutesOfDay: hour * 60 + minute,
  };
}

function parseTimeToMinutes(timeStr: string): number {
  const normalized = normalizeTime(timeStr, '09:00');
  const [hh, mm] = normalized.split(':');
  return Number(hh ?? 9) * 60 + Number(mm ?? 0);
}

export const proactiveMessagesPlugin: PluginTool = {
  declaration: {
    name: 'manage_proactive_messages',
    description:
      '管理桌寵的主動訊息、定時提醒與閒置關懷排程。支援新增排程(add)、列出所有排程與狀態(list)、啟用或停用排程/總開關(toggle)、切換 AI 隨機生成主題句子(toggle_ai)、刪除排程(delete)以及檢查目前是否有到期應觸發的主動訊息(check_due，若規則開啟 aiGenerated 則自動由 Gemini AI 根據主題與參考提示生成自然可愛的關懷句子，失敗時退回原 message)。',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: '操作類型：add | list | toggle | toggle_ai | delete | check_due',
        },
        rule_id: {
          type: 'STRING',
          description: '指定操作的排程 ID 或標題（用於 toggle、toggle_ai 或 delete；若 toggle 時不填或填 global 則切換整體主動訊息總開關）。',
        },
        title: {
          type: 'STRING',
          description: '排程標題／主題（用於 add，例如「早安問候」、「喝水提醒」）。',
        },
        message: {
          type: 'STRING',
          description: '主動訊息內容，或開啟 AI 隨機生成時的參考提示／備用內容（用於 add）。',
        },
        schedule_type: {
          type: 'STRING',
          description: '排程類型：daily（每日固定時間）、interval（固定間隔分鐘數）、idle（閒置超過指定分鐘數觸發）。',
        },
        time: {
          type: 'STRING',
          description: '每日觸發時間，格式為 24 小時制 HH:mm（例如 09:00、22:30，用於 schedule_type 為 daily 時）。',
        },
        interval_minutes: {
          type: 'STRING',
          description: '間隔或閒置分鐘數（正整數，例如 60，用於 schedule_type 為 interval 或 idle 時）。',
        },
        enabled: {
          type: 'STRING',
          description: '是否啟用排程：true 或 false（用於 add 或 toggle）。',
        },
        ai_generated: {
          type: 'STRING',
          description: '是否每次由 AI 根據主題(title)與參考提示(message)隨機生成關懷句子：true 或 false（預設 false，用於 add、toggle 或 toggle_ai）。',
        },
        timezone: {
          type: 'STRING',
          description: '時區設定，預設為 Asia/Taipei。',
        },
        idle_minutes: {
          type: 'STRING',
          description: '選填，用於 check_due 時傳入目前使用者已閒置的分鐘數。',
        },
        mark_triggered: {
          type: 'STRING',
          description: '選填，用於 check_due 時是否自動將到期規則標記為已觸發（預設為 true）。',
        },
      },
      required: ['action'],
    },
  },
  async execute(args: Record<string, unknown>, ctx: { userId: string }): Promise<Record<string, unknown>> {
    const userId = asTrimmedString(ctx?.userId) || 'default_user';
    const action = asTrimmedString(args.action).toLowerCase();

    if (!action || !['add', 'list', 'toggle', 'toggle_ai', 'delete', 'check_due'].includes(action)) {
      return {
        ok: false,
        error: '無效的 action 參數，請使用 add、list、toggle、toggle_ai、delete 或 check_due。',
      };
    }

    const store = await loadUserStore(userId, ctx);
    const tzArg = asTrimmedString(args.timezone);
    if (tzArg) {
      store.timezone = tzArg;
    }

    if (action === 'list') {
      return {
        ok: true,
        action: 'list',
        userId: store.userId,
        globalEnabled: store.globalEnabled,
        timezone: store.timezone,
        lastInteractionAt: store.lastInteractionAt,
        total: store.rules.length,
        rules: store.rules,
      };
    }

    if (action === 'add') {
      const rawTime = asTrimmedString(args.time);
      const rawInterval = args.interval_minutes ?? args.intervalMinutes;
      const rawScheduleType = asTrimmedString(args.schedule_type ?? args.scheduleType);
      const scheduleType = normalizeScheduleType(
        rawScheduleType,
        rawTime.length > 0,
        rawInterval !== undefined && rawInterval !== ''
      );

      const defaultTitleMap: Record<ScheduleType, string> = {
        daily: '每日定時問候',
        interval: '週期定時提醒',
        idle: '閒置關懷提醒',
      };
      const defaultMsgMap: Record<ScheduleType, string> = {
        daily: '嗨主人！到了我們約定的時間囉，今天一切都順利嗎？✨',
        interval: '主人～已經過了一段時間囉，記得喝口水、放鬆一下眼睛喔！💧',
        idle: '主人好久不見～忙完的話隨時來跟我聊聊天喔！🐾',
      };

      const rawTitle = asTrimmedString(args.title);
      const rawMessage = asTrimmedString(args.message);
      const title = rawTitle || (rawMessage ? rawMessage.slice(0, 20) : defaultTitleMap[scheduleType]);
      const message = rawMessage || rawTitle || defaultMsgMap[scheduleType];
      const time = normalizeTime(rawTime, scheduleType === 'daily' ? '09:00' : '00:00');
      const intervalMinutes = asPositiveInt(
        rawInterval,
        scheduleType === 'idle' ? 120 : 60
      );
      const enabled = asBoolean(args.enabled, true);
      const aiGenerated = asBoolean(args.ai_generated ?? args.aiGenerated, false);
      const nowIso = new Date().toISOString();
      const customId = asTrimmedString(args.rule_id ?? args.id);
      const id = customId || `rule-${crypto.randomUUID().slice(0, 8)}`;

      const newRule: ProactiveRule = {
        id,
        title,
        message,
        scheduleType,
        time,
        intervalMinutes,
        enabled,
        aiGenerated,
        createdAt: nowIso,
        lastTriggeredAt: null,
      };

      const existingIdx = store.rules.findIndex((r) => r.id === id);
      if (existingIdx >= 0) {
        store.rules[existingIdx] = newRule;
      } else {
        store.rules.push(newRule);
      }
      store.lastInteractionAt = nowIso;
      await saveUserStore(store, ctx);

      return {
        ok: true,
        action: 'add',
        globalEnabled: store.globalEnabled,
        timezone: store.timezone,
        rule: newRule,
        total: store.rules.length,
        rules: store.rules,
      };
    }

    if (action === 'toggle_ai') {
      const ruleId = asTrimmedString(args.rule_id ?? args.ruleId ?? args.id);
      if (!ruleId) {
        return {
          ok: false,
          action: 'toggle_ai',
          error: '請提供欲切換 AI 隨機生成設定的 rule_id。',
          rules: store.rules,
        };
      }

      const targetRule = store.rules.find((r) => r.id === ruleId || r.title === ruleId);
      if (!targetRule) {
        return {
          ok: false,
          action: 'toggle_ai',
          error: `找不到 ID 或標題為「${ruleId}」的排程。`,
          globalEnabled: store.globalEnabled,
          rules: store.rules,
        };
      }

      const rawAiVal = args.ai_generated ?? args.aiGenerated ?? args.enabled;
      const hasExplicitAi = rawAiVal !== undefined && rawAiVal !== '';
      targetRule.aiGenerated = hasExplicitAi
        ? asBoolean(rawAiVal, !targetRule.aiGenerated)
        : !targetRule.aiGenerated;
      store.lastInteractionAt = new Date().toISOString();
      await saveUserStore(store, ctx);

      return {
        ok: true,
        action: 'toggle_ai',
        target: 'rule_ai',
        globalEnabled: store.globalEnabled,
        rule: targetRule,
        rules: store.rules,
      };
    }

    if (action === 'toggle') {
      const ruleId = asTrimmedString(args.rule_id ?? args.ruleId ?? args.id);
      const hasExplicitEnabled = args.enabled !== undefined && args.enabled !== '';
      const rawAiVal = args.ai_generated ?? args.aiGenerated;
      const hasExplicitAi = rawAiVal !== undefined && rawAiVal !== '';

      if (!ruleId || ruleId.toLowerCase() === 'global' || ruleId.toLowerCase() === 'all') {
        store.globalEnabled = hasExplicitEnabled
          ? asBoolean(args.enabled, !store.globalEnabled)
          : !store.globalEnabled;
        store.lastInteractionAt = new Date().toISOString();
        await saveUserStore(store, ctx);
        return {
          ok: true,
          action: 'toggle',
          target: 'global',
          globalEnabled: store.globalEnabled,
          rules: store.rules,
        };
      }

      const targetRule = store.rules.find((r) => r.id === ruleId || r.title === ruleId);
      if (!targetRule) {
        return {
          ok: false,
          action: 'toggle',
          error: `找不到 ID 或標題為「${ruleId}」的排程。`,
          globalEnabled: store.globalEnabled,
          rules: store.rules,
        };
      }

      if (hasExplicitAi && !hasExplicitEnabled) {
        targetRule.aiGenerated = asBoolean(rawAiVal, !targetRule.aiGenerated);
      } else {
        targetRule.enabled = hasExplicitEnabled
          ? asBoolean(args.enabled, !targetRule.enabled)
          : !targetRule.enabled;
        if (hasExplicitAi) {
          targetRule.aiGenerated = asBoolean(rawAiVal, targetRule.aiGenerated);
        }
      }

      store.lastInteractionAt = new Date().toISOString();
      await saveUserStore(store, ctx);

      return {
        ok: true,
        action: 'toggle',
        target: 'rule',
        globalEnabled: store.globalEnabled,
        rule: targetRule,
        rules: store.rules,
      };
    }

    if (action === 'delete') {
      const ruleId = asTrimmedString(args.rule_id ?? args.ruleId ?? args.id);
      if (!ruleId) {
        return {
          ok: false,
          action: 'delete',
          error: '請提供欲刪除的 rule_id。',
          rules: store.rules,
        };
      }

      if (ruleId.toLowerCase() === 'all') {
        const deletedCount = store.rules.length;
        store.rules = [];
        store.lastInteractionAt = new Date().toISOString();
        await saveUserStore(store, ctx);
        return {
          ok: true,
          action: 'delete',
          deletedId: 'all',
          deletedCount,
          rules: store.rules,
        };
      }

      const beforeLen = store.rules.length;
      store.rules = store.rules.filter((r) => r.id !== ruleId && r.title !== ruleId);
      if (store.rules.length === beforeLen) {
        return {
          ok: false,
          action: 'delete',
          error: `找不到 ID 或標題為「${ruleId}」的排程。`,
          rules: store.rules,
        };
      }

      store.lastInteractionAt = new Date().toISOString();
      await saveUserStore(store, ctx);
      return {
        ok: true,
        action: 'delete',
        deletedId: ruleId,
        remainingCount: store.rules.length,
        rules: store.rules,
      };
    }

    // action === 'check_due'
    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const zonedNow = getZonedDateTime(now, store.timezone);
    const markTriggered = asBoolean(args.mark_triggered ?? args.markTriggered, true);

    const explicitIdleRaw = args.idle_minutes ?? args.idleMinutes;
    let effectiveIdleMinutes: number;
    if (explicitIdleRaw !== undefined && explicitIdleRaw !== '') {
      effectiveIdleMinutes = Math.max(0, Number(explicitIdleRaw) || 0);
    } else {
      const lastActiveMs = Date.parse(store.lastInteractionAt);
      effectiveIdleMinutes = Number.isFinite(lastActiveMs)
        ? Math.max(0, (nowMs - lastActiveMs) / 60000)
        : 0;
    }

    if (!store.globalEnabled) {
      return {
        ok: true,
        action: 'check_due',
        globalEnabled: false,
        hasDue: false,
        dueCount: 0,
        dueRules: [],
        checkedAt: nowIso,
        timezone: store.timezone,
        localDate: zonedNow.dateStr,
        localTime: zonedNow.timeStr,
      };
    }

    const matchedRules: ProactiveRule[] = [];

    for (const rule of store.rules) {
      if (!rule.enabled) continue;

      if (rule.scheduleType === 'daily') {
        const targetMinutes = parseTimeToMinutes(rule.time);
        const diffMinutes = zonedNow.minutesOfDay - targetMinutes;
        const withinDailyWindow = diffMinutes >= 0 && diffMinutes <= 180;

        let alreadyTriggeredToday = false;
        if (rule.lastTriggeredAt) {
          const lastDate = new Date(rule.lastTriggeredAt);
          if (!Number.isNaN(lastDate.getTime())) {
            const zonedLast = getZonedDateTime(lastDate, store.timezone);
            if (zonedLast.dateStr === zonedNow.dateStr) {
              alreadyTriggeredToday = true;
            }
          }
        }

        if (withinDailyWindow && !alreadyTriggeredToday) {
          matchedRules.push(rule);
          if (markTriggered) {
            rule.lastTriggeredAt = nowIso;
          }
        }
      } else if (rule.scheduleType === 'interval') {
        const intervalMs = rule.intervalMinutes * 60 * 1000;
        const refIso = rule.lastTriggeredAt || rule.createdAt;
        const refMs = Date.parse(refIso);
        if (!Number.isFinite(refMs) || nowMs - refMs >= intervalMs) {
          matchedRules.push(rule);
          if (markTriggered) {
            rule.lastTriggeredAt = nowIso;
          }
        }
      } else if (rule.scheduleType === 'idle') {
        const cooldownMs = rule.intervalMinutes * 60 * 1000;
        const lastTrigMs = rule.lastTriggeredAt ? Date.parse(rule.lastTriggeredAt) : 0;
        const cooldownPassed = !lastTrigMs || !Number.isFinite(lastTrigMs) || nowMs - lastTrigMs >= cooldownMs;

        if (effectiveIdleMinutes >= rule.intervalMinutes && cooldownPassed) {
          matchedRules.push(rule);
          if (markTriggered) {
            rule.lastTriggeredAt = nowIso;
          }
        }
      }
    }

    if (markTriggered && matchedRules.length > 0) {
      await saveUserStore(store, ctx);
    }

    const dueRules: Array<ProactiveRule & { originalMessage?: string; aiGeneratedSuccess?: boolean }> = [];
    for (const rule of matchedRules) {
      if (rule.aiGenerated) {
        const genResult = await generateAiCareSentence(rule, zonedNow, ctx, args);
        dueRules.push({
          ...rule,
          message: genResult.message,
          originalMessage: rule.message,
          aiGeneratedSuccess: genResult.aiGeneratedSuccess,
        });
      } else {
        dueRules.push({
          ...rule,
          originalMessage: rule.message,
          aiGeneratedSuccess: false,
        });
      }
    }

    return {
      ok: true,
      action: 'check_due',
      globalEnabled: store.globalEnabled,
      hasDue: dueRules.length > 0,
      dueCount: dueRules.length,
      dueRules,
      effectiveIdleMinutes: Math.round(effectiveIdleMinutes),
      checkedAt: nowIso,
      timezone: store.timezone,
      localDate: zonedNow.dateStr,
      localTime: zonedNow.timeStr,
    };
  },
};
