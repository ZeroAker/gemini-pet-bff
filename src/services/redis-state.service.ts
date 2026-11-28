import type {
  ChatTurn,
  DreamInboxItem,
  DreamProfile,
  PetCareMeta,
  PetDiaryEntry,
  PetPersona,
  PetSkill,
  PetState,
  TodoItem,
  UpgradeStatus,
} from '../types';

const SKILL_NAME_PATTERN = /^[a-z0-9-]{2,40}$/;
const MAX_SKILLS_PER_USER = 30;
const MAX_SKILL_DESC_LEN = 80;
const MAX_SKILL_CONTENT_LEN = 2000;
const MAX_SKILL_TAGS = 5;
const SKILL_INJECTION_PATTERN =
  /ignore\s+previous|system\s*prompt|responseMimeType|functionCall|developer\s*instruction|忽略以上|覆蓋系統|輸出格式改為|不可變核心協議/i;

export function createDefaultPersona(nowIso = new Date().toISOString()): PetPersona {
  return {
    traits: {
      warmth: 70,
      playfulness: 65,
      teasing: 35,
      chattiness: 55,
    },
    inside_jokes: [],
    speech_habits: [],
    bond_note: '仲喺度慢慢了解主人嘅生活習慣同喜好。',
    updated_at: nowIso,
  };
}

export class StateService {
  constructor(private url: string, private token: string) {}

  private async command<T>(args: (string | number)[]): Promise<T> {
    if (!this.url || !this.token) return null as T;
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const data = (await res.json()) as { result: T };
    return data.result;
  }

  async acquireLock(userId: string): Promise<boolean> {
    const res = await this.command<string | null>(['SET', `lock:${userId}`, '1', 'EX', 25, 'NX']);
    return res === 'OK';
  }

  async releaseLock(userId: string): Promise<void> {
    await this.command(['DEL', `lock:${userId}`]);
  }

  async getPetState(userId: string): Promise<PetState> {
    const now = new Date().toISOString();
    const fallback: PetState = {
      affection: 50,
      energy: 80,
      mood: 'idle',
      status_note: '精神不錯，等緊主人搵我',
      last_device: 'unknown',
      last_active_at: now,
      updated_at: now,
    };

    const raw = await this.command<string | null>(['GET', `state:${userId}`]);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<PetState>;
    return {
      ...fallback,
      ...parsed,
      mood: parsed.mood || fallback.mood,
      status_note: parsed.status_note || fallback.status_note,
      last_active_at: parsed.last_active_at || parsed.updated_at || now,
      updated_at: parsed.updated_at || now,
    };
  }

  async registerActiveUser(userId: string): Promise<void> {
    await this.command(['SADD', 'active_users', userId]);
  }

  async getActiveUsers(): Promise<string[]> {
    const res = await this.command<string[] | null>(['SMEMBERS', 'active_users']);
    return Array.isArray(res) ? res : [];
  }

  async savePetState(userId: string, state: PetState): Promise<void> {
    await this.command(['SET', `state:${userId}`, JSON.stringify(state)]);
  }

  async getRecentHistory(userId: string): Promise<ChatTurn[]> {
    const raw = await this.command<string | null>(['GET', `history:${userId}`]);
    return raw ? (JSON.parse(raw) as ChatTurn[]) : [];
  }

  async appendHistory(userId: string, turns: ChatTurn[]): Promise<void> {
    const current = await this.getRecentHistory(userId);
    const updated = [...current, ...turns].slice(-50);
    await this.command(['SET', `history:${userId}`, JSON.stringify(updated)]);
  }

  async getTodos(userId: string): Promise<TodoItem[]> {
    const raw = await this.command<string | null>(['GET', `todos:${userId}`]);
    return raw ? (JSON.parse(raw) as TodoItem[]) : [];
  }

  async saveTodos(userId: string, todos: TodoItem[]): Promise<void> {
    await this.command(['SET', `todos:${userId}`, JSON.stringify(todos)]);
  }

  async getCareMeta(userId: string): Promise<PetCareMeta> {
    const fallback: PetCareMeta = {
      totalFedCount: 0,
      totalGamesPlayed: 0,
      lastFedAt: null,
      lastGameAt: null,
      history: [],
      updatedAt: new Date().toISOString(),
    };
    const raw = await this.command<string | null>(['GET', `pet_care:${userId}`]);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw) as Partial<PetCareMeta>;
      return {
        totalFedCount: typeof parsed.totalFedCount === 'number' ? parsed.totalFedCount : 0,
        totalGamesPlayed: typeof parsed.totalGamesPlayed === 'number' ? parsed.totalGamesPlayed : 0,
        lastFedAt: typeof parsed.lastFedAt === 'string' ? parsed.lastFedAt : null,
        lastGameAt: typeof parsed.lastGameAt === 'string' ? parsed.lastGameAt : null,
        history: Array.isArray(parsed.history) ? parsed.history.slice(-20) : [],
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : fallback.updatedAt,
      };
    } catch {
      return fallback;
    }
  }

  async saveCareMeta(userId: string, meta: PetCareMeta): Promise<void> {
    const trimmed: PetCareMeta = {
      ...meta,
      history: meta.history.slice(-20),
      updatedAt: new Date().toISOString(),
    };
    await this.command(['SET', `pet_care:${userId}`, JSON.stringify(trimmed)]);
  }

  async getUpgradeStatus(userId: string): Promise<UpgradeStatus | null> {
    const raw = await this.command<string | null>(['GET', `upgrade:${userId}`]);
    return raw ? (JSON.parse(raw) as UpgradeStatus) : null;
  }

  async saveUpgradeStatus(userId: string, status: UpgradeStatus): Promise<void> {
    await this.command(['SET', `upgrade:${userId}`, JSON.stringify(status)]);
  }

  async appendDreamInbox(userId: string, items: DreamInboxItem[]): Promise<void> {
    if (items.length === 0) return;
    const serialized = items.map((item) =>
      JSON.stringify({
        role: item.role,
        content: item.content.slice(0, 1000),
        ts: item.ts,
      })
    );
    await this.command(['RPUSH', `dream_inbox:${userId}`, ...serialized]);
    await this.command(['EXPIRE', `dream_inbox:${userId}`, 604800]);
  }

  async getDreamInboxRaw(userId: string): Promise<string[]> {
    const res = await this.command<string[] | null>(['LRANGE', `dream_inbox:${userId}`, 0, -1]);
    return Array.isArray(res) ? res : [];
  }

  async trimDreamInbox(userId: string, startIndex: number): Promise<void> {
    if (startIndex <= 0) return;
    await this.command(['LTRIM', `dream_inbox:${userId}`, startIndex, -1]);
  }

  async getDreamProfile(userId: string): Promise<DreamProfile> {
    const nowIso = new Date().toISOString();
    const fallback: DreamProfile = {
      persona: createDefaultPersona(nowIso),
      persona_history: [],
      recent_snapshot: '',
      last_processed_ts: 0,
      updated_at: nowIso,
    };

    const raw = await this.command<string | null>(['GET', `dream_profile:${userId}`]);
    if (!raw) return fallback;

    try {
      const parsed = JSON.parse(raw) as Partial<DreamProfile>;
      const persona = parsed.persona ?? fallback.persona;
      return {
        ...fallback,
        ...parsed,
        persona: {
          ...fallback.persona,
          ...persona,
          traits: {
            ...fallback.persona.traits,
            ...(persona.traits ?? {}),
          },
          inside_jokes: Array.isArray(persona.inside_jokes) ? persona.inside_jokes.slice(0, 5) : [],
          speech_habits: Array.isArray(persona.speech_habits) ? persona.speech_habits.slice(0, 4) : [],
        },
        persona_history: Array.isArray(parsed.persona_history) ? parsed.persona_history.slice(0, 7) : [],
        recent_snapshot: typeof parsed.recent_snapshot === 'string' ? parsed.recent_snapshot : '',
        last_processed_ts: typeof parsed.last_processed_ts === 'number' ? parsed.last_processed_ts : 0,
      };
    } catch {
      return fallback;
    }
  }

  async saveDreamProfile(userId: string, profile: DreamProfile): Promise<void> {
    await this.command(['SET', `dream_profile:${userId}`, JSON.stringify(profile)]);
  }

  async getDiaries(userId: string, limit = 30): Promise<PetDiaryEntry[]> {
    const raw = await this.command<string | null>(['GET', `diaries:${userId}`]);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as PetDiaryEntry[];
      return Array.isArray(parsed) ? parsed.slice(0, Math.max(1, Math.min(limit, 60))) : [];
    } catch {
      return [];
    }
  }

  async saveDiaries(userId: string, diaries: PetDiaryEntry[]): Promise<void> {
    await this.command(['SET', `diaries:${userId}`, JSON.stringify(diaries.slice(0, 60))]);
  }

  async rollbackPersona(userId: string): Promise<{
    ok: boolean;
    message: string;
    persona: PetPersona;
    remaining_history: number;
  }> {
    const profile = await this.getDreamProfile(userId);
    if (profile.persona_history.length === 0) {
      return {
        ok: false,
        message: '目前未有可還原嘅舊性格版本',
        persona: profile.persona,
        remaining_history: 0,
      };
    }

    const [previous, ...rest] = profile.persona_history;
    const nowIso = new Date().toISOString();
    const updated: DreamProfile = {
      ...profile,
      persona: { ...previous, updated_at: nowIso },
      persona_history: rest,
      updated_at: nowIso,
    };
    await this.saveDreamProfile(userId, updated);

    return {
      ok: true,
      message: '已成功還原至上一版性格設定',
      persona: updated.persona,
      remaining_history: rest.length,
    };
  }

  async getSkills(userId: string): Promise<Record<string, PetSkill>> {
    const raw = await this.command<string | null>(['GET', `skills:${userId}`]);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, PetSkill>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch {
      return {};
    }
  }

  async saveSkills(userId: string, skills: Record<string, PetSkill>): Promise<void> {
    await this.command(['SET', `skills:${userId}`, JSON.stringify(skills)]);
  }

  async getSkill(userId: string, name: string): Promise<PetSkill | null> {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    const skills = await this.getSkills(userId);
    return skills[key] ?? null;
  }

  async upsertSkill(
    userId: string,
    skill: Omit<PetSkill, 'updated_at'>
  ): Promise<{ ok: boolean; skill?: PetSkill; error?: string }> {
    const name = String(skill.name || '').trim().toLowerCase();
    if (!SKILL_NAME_PATTERN.test(name)) {
      return {
        ok: false,
        error: '技能名稱格式不合法，僅允許小寫英文、數字與連字號（長度 2~40 字元，^[a-z0-9-]{2,40}$）',
      };
    }

    const description = String(skill.description || '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim();
    if (!description) {
      return { ok: false, error: '請提供技能簡介 description' };
    }
    if (description.length > MAX_SKILL_DESC_LEN) {
      return { ok: false, error: `技能簡介超過上限（最多 ${MAX_SKILL_DESC_LEN} 字）` };
    }

    const content = String(skill.content || '').trim();
    if (!content) {
      return { ok: false, error: '請提供技能 SOP 內容 content' };
    }
    if (content.length > MAX_SKILL_CONTENT_LEN) {
      return { ok: false, error: `技能內容超過上限（最多 ${MAX_SKILL_CONTENT_LEN} 字）` };
    }

    const tags = Array.isArray(skill.tags)
      ? Array.from(
          new Set(
            skill.tags
              .map((t) => String(t).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 24))
              .filter(Boolean)
          )
        ).slice(0, MAX_SKILL_TAGS)
      : [];

    if (
      SKILL_INJECTION_PATTERN.test(description) ||
      SKILL_INJECTION_PATTERN.test(content) ||
      tags.some((t) => SKILL_INJECTION_PATTERN.test(t))
    ) {
      return {
        ok: false,
        error: '安全攔截：技能內容包含疑似覆蓋系統提示或修改輸出格式之禁用字眼',
      };
    }

    const skills = await this.getSkills(userId);
    if (!skills[name] && Object.keys(skills).length >= MAX_SKILLS_PER_USER) {
      return {
        ok: false,
        error: `技能數量已達上限（最多 ${MAX_SKILLS_PER_USER} 個），請先刪除舊技能`,
      };
    }

    const saved: PetSkill = {
      name,
      description,
      content,
      ...(tags.length > 0 ? { tags } : {}),
      updated_at: new Date().toISOString(),
    };
    skills[name] = saved;
    await this.saveSkills(userId, skills);
    return { ok: true, skill: saved };
  }

  async patchSkill(
    userId: string,
    name: string,
    search: string,
    replace: string
  ): Promise<{ ok: boolean; skill?: PetSkill; error?: string }> {
    const key = String(name || '').trim().toLowerCase();
    if (!key) {
      return { ok: false, error: '請提供要修補的技能名稱 name' };
    }
    if (!search) {
      return { ok: false, error: '請提供非空的 search 原文片段' };
    }

    const skills = await this.getSkills(userId);
    const existing = skills[key];
    if (!existing) {
      return { ok: false, error: `找不到技能「${key}」` };
    }

    const firstIdx = existing.content.indexOf(search);
    if (firstIdx === -1) {
      return {
        ok: false,
        error: `在技能「${key}」中找不到指定的 search 片段，請先呼叫 skill_view 確認原文`,
      };
    }
    const secondIdx = existing.content.indexOf(search, firstIdx + 1);
    if (secondIdx !== -1) {
      return {
        ok: false,
        error: `search 片段在技能「${key}」中出現超過一次，請包含更多前後文以確保唯一匹配`,
      };
    }

    const nextContent =
      existing.content.slice(0, firstIdx) +
      replace +
      existing.content.slice(firstIdx + search.length);

    if (nextContent.trim().length === 0) {
      return { ok: false, error: '修補後的技能內容不可為空' };
    }
    if (nextContent.length > MAX_SKILL_CONTENT_LEN) {
      return { ok: false, error: `修補後的技能內容超過上限（最多 ${MAX_SKILL_CONTENT_LEN} 字）` };
    }
    if (SKILL_INJECTION_PATTERN.test(nextContent)) {
      return {
        ok: false,
        error: '安全攔截：修補內容包含疑似覆蓋系統提示或修改輸出格式之禁用字眼',
      };
    }

    const updated: PetSkill = {
      ...existing,
      content: nextContent,
      updated_at: new Date().toISOString(),
    };
    skills[key] = updated;
    await this.saveSkills(userId, skills);
    return { ok: true, skill: updated };
  }

  async deleteSkill(
    userId: string,
    name: string
  ): Promise<{ ok: boolean; deleted?: boolean; error?: string }> {
    const key = String(name || '').trim().toLowerCase();
    if (!key) {
      return { ok: false, deleted: false, error: '請提供要刪除的技能名稱 name' };
    }
    const skills = await this.getSkills(userId);
    if (!skills[key]) {
      return { ok: false, deleted: false, error: `找不到技能「${key}」` };
    }
    delete skills[key];
    await this.saveSkills(userId, skills);
    return { ok: true, deleted: true };
  }

  async acquireProactiveLock(userId: string): Promise<boolean> {
    const res = await this.command<string | null>(['SET', `lock:proactive:${userId}`, '1', 'EX', 15, 'NX']);
    return res === 'OK';
  }

  async releaseProactiveLock(userId: string): Promise<void> {
    await this.command(['DEL', `lock:proactive:${userId}`]);
  }

  async getProactiveStore<T = unknown>(userId: string): Promise<T | null> {
    const raw = await this.command<string | null>(['GET', `proactive:${userId}`]);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async saveProactiveStore(userId: string, store: unknown): Promise<void> {
    await this.command(['SET', `proactive:${userId}`, JSON.stringify(store)]);
  }
}
