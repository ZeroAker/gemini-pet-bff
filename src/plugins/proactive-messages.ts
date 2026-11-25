import type { PluginTool } from '../types';

type PetEmotion = 'idle' | 'happy' | 'thinking' | 'sleepy' | 'caring';
type ScheduleStatus = 'pending' | 'sent';

interface ProactiveScheduleItem {
  id: string;
  userId: string;
  title: string;
  message: string;
  emotion: PetEmotion;
  triggerAtMs: number;
  triggerAtIso: string;
  triggerAtLocal: string;
  repeatMinutes: number;
  status: ScheduleStatus;
  createdAtIso: string;
  lastTriggeredAtIso?: string;
}

interface CloudflareCacheStorage {
  default?: Cache;
}

const VALID_EMOTIONS: readonly PetEmotion[] = ['idle', 'happy', 'thinking', 'sleepy', 'caring'];
const DEFAULT_TZ_OFFSET_MINUTES = 480;
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const memoryStore = new Map<string, ProactiveScheduleItem[]>();

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeEmotion(value: unknown): PetEmotion {
  const raw = asTrimmedString(value).toLowerCase();
  if ((VALID_EMOTIONS as readonly string[]).includes(raw)) {
    return raw as PetEmotion;
  }
  return 'caring';
}

function formatTaipeiTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8);
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function getCacheInstance(): Cache | null {
  const storage = (globalThis as { caches?: CloudflareCacheStorage }).caches;
  return storage?.default ?? null;
}

function buildCacheRequest(userId: string): Request {
  const safeId = encodeURIComponent(userId || 'default');
  return new Request(`https://proactive-messages.pet.internal/schedules/${safeId}`);
}

async function loadSchedules(userId: string): Promise<ProactiveScheduleItem[]> {
  const inMem = memoryStore.get(userId);
  if (inMem) {    return [...inMem];
  }

  const cache = getCacheInstance();
  if (cache) {
    try {
      const matched = await cache.match(buildCacheRequest(userId));
      if (matched) {
        const parsed = (await matched.json()) as unknown;
        if (Array.isArray(parsed)) {
          const items = parsed as ProactiveScheduleItem[];
          memoryStore.set(userId, items);
          return [...items];
        }
      }
    } catch {
      // Ignore cache read error and fallback to empty list
    }
  }

  return [];
}

async function saveSchedules(userId: string, items: ProactiveScheduleItem[]): Promise<void> {
  memoryStore.set(userId, items);
  const cache = getCacheInstance();
  if (cache) {
    try {
      const response = new Response(JSON.stringify(items), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `max-age=${CACHE_TTL_SECONDS}`,
        },
      });
      await cache.put(buildCacheRequest(userId), response);
    } catch {
      // Ignore cache write error; memoryStore already updated
    }
  }
}

function parseTriggerTimeMs(
  delayMinutes: number | null,
  triggerAtRaw: string,
  tzOffsetMinutes: number,
  nowMs: number
): { ok: true; triggerAtMs: number } | { ok: false; error: string } {
  if (delayMinutes !== null) {
    if (delayMinutes <= 0) {
      return { ok: false, error: 'delay_minutes 必須大於 0。' };
    }
    return { ok: true, triggerAtMs: nowMs + Math.round(delayMinutes * 60_000) };
  }

  if (!triggerAtRaw) {
    return { ok: false, error: '請提供 delay_minutes（延遲分鐘數）或 trigger_at（觸發時間）。' };
  }

  const hhmmMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(triggerAtRaw);
  if (hhmmMatch) {
    const hour = Number(hhmmMatch[1]);
    const minute = Number(hhmmMatch[2]);
    const second = hhmmMatch[3] ? Number(hhmmMatch[3]) : 0;
    if (hour > 23 || minute > 59 || second > 59) {
      return { ok: false, error: 'trigger_at 時間格式無效，小時須為 0-23、分秒須為 0-59。' };
    }
    const offsetMs = tzOffsetMinutes * 60_000;
    const localNow = new Date(nowMs + offsetMs);
    let candidateMs =
      Date.UTC(
        localNow.getUTCFullYear(),
        localNow.getUTCMonth(),
        localNow.getUTCDate(),
        hour,
        minute,
        second
      ) - offsetMs;
    if (candidateMs <= nowMs) {
      candidateMs += 24 * 60 * 60_000;
    }
    return { ok: true, triggerAtMs: candidateMs };
  }

  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(triggerAtRaw);
  if (hasExplicitZone) {
    const parsed = Date.parse(triggerAtRaw);
    if (Number.isNaN(parsed)) {
      return { ok: false, error: '無法解析 trigger_at ISO 時間字串。' };
    }
    return { ok: true, triggerAtMs: parsed };
  }

  const localDateTimeMatch =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(triggerAtRaw);
  if (localDateTimeMatch) {
    const year = Number(localDateTimeMatch[1]);
    const month = Number(localDateTimeMatch[2]) - 1;
    const day = Number(localDateTimeMatch[3]);
    const hour = Number(localDateTimeMatch[4]);
    const minute = Number(localDateTimeMatch[5]);
    const second = localDateTimeMatch[6] ? Number(localDateTimeMatch[6]) : 0;
    const offsetMs = tzOffsetMinutes * 60_000;
    const targetMs = Date.UTC(year, month, day, hour, minute, second) - offsetMs;
    if (Number.isNaN(targetMs)) {
      return { ok: false, error: '無法解析 trigger_at 日期時間。' };
    }
    return { ok: true, triggerAtMs: targetMs };
  }

  const fallbackParsed = Date.parse(triggerAtRaw);
  if (Number.isNaN(fallbackParsed)) {
    return {
      ok: false,
      error: '無法解析 trigger_at，請使用 ISO 8601、YYYY-MM-DD HH:mm 或 HH:mm 格式。',
    };
  }
  return { ok: true, triggerAtMs: fallbackParsed };
}

function formatScheduleForOutput(item: ProactiveScheduleItem): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    message: item.message,
    emotion: item.emotion,
    status: item.status,
    trigger_at: item.triggerAtIso,
    trigger_at_local: item.triggerAtLocal,
    trigger_at_ms: item.triggerAtMs,
    repeat_minutes: item.repeatMinutes,
    created_at: item.createdAtIso,
    last_triggered_at: item.lastTriggeredAtIso ?? null,
  };
}

export const proactiveMessagesPlugin: PluginTool = {
  declaration: {
    name: 'manage_proactive_messages',
    description:
      '管理桌寵的主動訊息與定時關懷/提醒排程。支援設定排程主動訊息（指定觸發時間或延遲分鐘數、訊息內容、桌寵情緒與重複間隔）、查詢待發送清單、刪除指定或全部排程，以及檢查目前是否有到期應發送的主動訊息。',
    parameters: {
      type: 'OBJECT',
      properties: {
        action:
          {
            type: 'STRING',
            description: '操作類型：schedule（新增排程）、list（查詢清單）、delete（刪除排程）、check_due（檢查並取出到期主動訊息）。',
          },
        id: {
          type: 'STRING',
          description: '排程 ID（action 為 delete 且未指定 clear_all 時必填）。',
        },
        message: {
          type: 'STRING',
          description: '桌寵要主動發送的關懷或提醒訊息內容（action 為 schedule 時必填）。',
        },
        title: {
          type: 'STRING',
          description: '主動通知標題（選填，預設為「Gemini 桌寵主動訊息」）。',
        },
        emotion: {
          type: 'STRING',
          description: '發送訊息時的桌寵情緒：idle、happy、thinking、sleepy 或 caring（預設 caring）。',
        },
        delay_minutes: {
          type: 'NUMBER',
          description: '延遲幾分鐘後觸發（例如 10 表示 10 分鐘後；與 trigger_at 擇一填寫）。',
        },
        trigger_at: {
          type: 'STRING',
          description: '指定觸發時間，支援 ISO 8601、YYYY-MM-DD HH:mm 或 HH:mm（未含時區時預設以 UTC+8 計算）。',
        },
        repeat_minutes: {
          type: 'NUMBER',
          description: '重複間隔分鐘數（選填，0 或未填表示單次發送）。',
        },
        timezone_offset_minutes: {
          type: 'NUMBER',
          description: '時區偏移分鐘數（選填，預設 480 代表 UTC+8 台北時間）。',
        },
        status_filter: {
          type: 'STRING',
          description: '查詢清單時的狀態篩選：pending（預設）、sent 或 all。',
        },
        mark_sent: {
          type: 'BOOLEAN',
          description: '執行 check_due 時是否自動將已到期的單次訊息標記為 sent 或推進重複排程（預設 true）。',
        },
        clear_all: {
          type: 'BOOLEAN',
          description: '執行 delete 時若設為 true，將清空該使用者的所有主動訊息排程。',
        },
      },
      required: ['action'],
    },
  },
  async execute(args: Record<string, unknown>, ctx: { userId: string }): Promise<Record<string, unknown>> {
    const userId = asTrimmedString(ctx.userId) || 'default';
    const action = asTrimmedString(args.action).toLowerCase();
    const nowMs = Date.now();

    if (action === 'schedule' || action === 'add' || action === 'create') {
      const message = asTrimmedString(args.message);
      if (!message) {
        return { ok: false, error: '排程主動訊息必須提供 message 內容。' };
      }

      const delayMinutes = asFiniteNumber(args.delay_minutes);
      const triggerAtRaw = asTrimmedString(args.trigger_at);
      const tzOffset = asFiniteNumber(args.timezone_offset_minutes) ?? DEFAULT_TZ_OFFSET_MINUTES;
      const parsedTrigger = parseTriggerTimeMs(delayMinutes, triggerAtRaw, tzOffset, nowMs);
      if (!parsedTrigger.ok) {
        return { ok: false, error: parsedTrigger.error };
      }

      const repeatMinutesRaw = asFiniteNumber(args.repeat_minutes) ?? 0;
      const repeatMinutes = repeatMinutesRaw > 0 ? Math.round(repeatMinutesRaw) : 0;
      const title = asTrimmedString(args.title) || 'Gemini 桌寵主動訊息';
      const emotion = normalizeEmotion(args.emotion);

      const item: ProactiveScheduleItem = {
        id: generateId(),
        userId,
        title,
        message,
        emotion,
        triggerAtMs: parsedTrigger.triggerAtMs,
        triggerAtIso: new Date(parsedTrigger.triggerAtMs).toISOString(),
        triggerAtLocal: formatTaipeiTime(parsedTrigger.triggerAtMs),
        repeatMinutes,
        status: 'pending',
        createdAtIso: new Date(nowMs).toISOString(),
      };

      const items = await loadSchedules(userId);
      items.push(item);
      items.sort((a, b) => a.triggerAtMs - b.triggerAtMs);
      await saveSchedules(userId, items);

      const pendingCount = items.filter((entry) => entry.status === 'pending').length;
      return {
        ok: true,
        action: 'schedule',
        scheduled_item: formatScheduleForOutput(item),
        pending_count: pendingCount,
      };
    }

    if (action === 'list') {
      const filterRaw = asTrimmedString(args.status_filter).toLowerCase();
      const filter: 'pending' | 'sent' | 'all' =
        filterRaw === 'sent' || filterRaw === 'all' ? filterRaw : 'pending';
      const items = await loadSchedules(userId);
      const filtered = items
        .filter((entry) => (filter === 'all' ? true : entry.status === filter))
        .sort((a, b) => a.triggerAtMs - b.triggerAtMs);

      return {
        ok: true,
        action: 'list',
        status_filter: filter,
        count: filtered.length,
        schedules: filtered.map(formatScheduleForOutput),
      };
    }

    if (action === 'delete' || action === 'remove' || action === 'cancel') {
      const clearAll = args.clear_all === true;
      const items = await loadSchedules(userId);

      if (clearAll) {
        const removedCount = items.length;
        await saveSchedules(userId, []);
        return {
          ok: true,
          action: 'delete',
          cleared_all: true,
          removed_count: removedCount,
          pending_count: 0,
        };
      }

      const targetId = asTrimmedString(args.id);
      if (!targetId) {
        return { ok: false, error: '刪除排程時必須提供 id，或設定 clear_all: true。' };
      }

      const nextItems = items.filter((entry) => entry.id !== targetId);
      const deleted = nextItems.length < items.length;
      if (deleted) {
        await saveSchedules(userId, nextItems);
      }

      return {
        ok: deleted,
        action: 'delete',
        id: targetId,
        deleted,
        pending_count: nextItems.filter((entry) => entry.status === 'pending').length,
        error: deleted ? undefined : `找不到 ID 為 ${targetId} 的主動訊息排程。`,
      };
    }

    if (action === 'check_due' || action === 'check' || action === 'poll') {
      const markSent = args.mark_sent !== false;
      const items = await loadSchedules(userId);
      const dueItems: ProactiveScheduleItem[] = [];
      let modified = false;

      const updatedItems = items.map((entry) => {
        if (entry.status !== 'pending' || entry.triggerAtMs > nowMs) {
          return entry;
        }
        dueItems.push({ ...entry });
        if (!markSent) {
          return entry;
        }
        modified = true;
        if (entry.repeatMinutes > 0) {
          const intervalMs = entry.repeatMinutes * 60_000;
          let nextMs = entry.triggerAtMs + intervalMs;
          while (nextMs <= nowMs) {
            nextMs += intervalMs;
          }
          return {
            ...entry,
            triggerAtMs: nextMs,
            triggerAtIso: new Date(nextMs).toISOString(),
            triggerAtLocal: formatTaipeiTime(nextMs),
            lastTriggeredAtIso: new Date(nowMs).toISOString(),
          };
        }
        return {
          ...entry,
          status: 'sent' as const,
          lastTriggeredAtIso: new Date(nowMs).toISOString(),
        };
      });

      if (modified) {
        await saveSchedules(userId, updatedItems);
      }

      const pending = updatedItems
        .filter((entry) => entry.status === 'pending')
        .sort((a, b) => a.triggerAtMs - b.triggerAtMs);

      return {
        ok: true,
        action: 'check_due',
        checked_at: new Date(nowMs).toISOString(),
        checked_at_local: formatTaipeiTime(nowMs),
        due_count: dueItems.length,
        due_messages: dueItems.map(formatScheduleForOutput),
        pending_count: pending.length,
        next_due_at: pending[0] ? pending[0].triggerAtLocal : null,
      };
    }

    return {
      ok: false,
      error: `不支援的 action：${action || '(空)'}。請使用 schedule、list、delete 或 check_due。`,
    };
  },
};
