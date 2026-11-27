import { executeAgentTool, getToolDeclarationsForIntent } from './tools';
import {
  formatStickerPromptCatalog,
  getBotStickerById,
  getStickerById,
} from './plugins/stickers';
import type {
  ChatTurn,
  ComplexityTier,
  DreamInboxItem,
  DreamProfile,
  Env,
  PetDiaryEntry,
  PetPersona,
  PetSkill,
  PetState,
  PetStructuredReply,
  RouteDecision,
  TodoItem,
  UpgradeStatus,
  PetCareMeta
} from './types';

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
  constructor(private url: string, private token: string) { }

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
    const updated = [...current, ...turns].slice(-12);
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
}

export class MemoryService {
  constructor(private apiKey: string) { }

  async searchMemories(userId: string, query: string): Promise<string[]> {
    if (!this.apiKey) return [];
    const res = await fetch('https://api.mem0.ai/v3/memories/search/', {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        filters: { user_id: userId },
        top_k: 5,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ memory: string }> };
    return (data.results ?? []).map((item) => item.memory);
  }

  async addMemory(userId: string, messages: ChatTurn[]): Promise<void> {
    if (!this.apiKey) return;
    await fetch('https://api.mem0.ai/v3/memories/add/', {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId, messages }),
    });
  }
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export class GeminiService {
  private env: Env;
  private apiKey: string;
  private projectId: string;
  private location: string;
  private models: Record<ComplexityTier, string[]>;

  constructor(env: Env) {
    this.env = env;
    this.apiKey = (env.GOOGLE_CLOUD_API_KEY || '').trim();
    this.projectId = (env.GCP_PROJECT_ID || '').trim();
    this.location = (env.GCP_LOCATION || 'global').trim();

    const fast = (env.MODEL_FAST || 'gemini-3.5-flash-lite').trim();
    const balanced = (env.MODEL_BALANCED || 'gemini-4-hydrogen').trim();
    const deep = (env.MODEL_DEEP || 'gemini-4-argon').trim();

    // 全面改用 3.5 / 3.8 / 4 現役模型作為主路徑與自動備援鏈
    this.models = {
      simple: Array.from(new Set([fast, 'gemini-3.8-flash', balanced])),
      medium: Array.from(new Set([balanced, 'gemini-3.8-flash', fast])),
      complex: Array.from(new Set([deep, 'gemini-4-argon', balanced, 'gemini-3.8-flash', fast])),
    };
  }

  private buildEndpoint(model: string): string {
    const keyParam = `key=${encodeURIComponent(this.apiKey)}`;
    if (!this.projectId) {
      return `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?${keyParam}`;
    }
    const host =
      this.location === 'global'
        ? 'https://aiplatform.googleapis.com'
        : `https://${this.location}-aiplatform.googleapis.com`;
    return `${host}/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${model}:generateContent?${keyParam}`;
  }

  // 依模型世代自動產生合規的 generationConfig（避免 Gemini 4 與 3.x 參數衝突）
  private buildGenerationConfig(
    model: string,
    options: { tier: ComplexityTier; forceJson: boolean; isRouter?: boolean }
  ): Record<string, unknown> {
    const isGemini4 = model.startsWith('gemini-4');

    if (isGemini4) {
      const thinkingLevel =
        options.isRouter || options.tier === 'simple'
          ? 'LOW'
          : options.tier === 'medium'
            ? 'MEDIUM'
            : 'HIGH';

      return {
        thinkingConfig: { thinkingLevel },
        ...(options.forceJson ? { responseMimeType: 'application/json' } : {}),
      };
    }

    // Gemini 3.5 / 3.8 系列
    return {
      temperature: options.isRouter ? 0 : options.tier === 'complex' ? 0.4 : 0.7,
      ...(options.isRouter ? { maxOutputTokens: 120 } : {}),
      ...(options.forceJson ? { responseMimeType: 'application/json' } : {}),
    };
  }

  private async callVertex(
    candidateModels: string[],
    buildPayload: (model: string) => Record<string, unknown>
  ): Promise<{ modelUsed: string; parts: GeminiPart[] }> {
    const errors: string[] = [];

    for (const model of candidateModels) {
      const res = await fetch(this.buildEndpoint(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(model)),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
        };
        return {
          modelUsed: model,
          parts: data.candidates?.[0]?.content?.parts ?? [],
        };
      }

      const errText = await res.text();
      errors.push(`[${model} -> ${res.status}] ${errText.slice(0, 160)}`);
      if (res.status !== 403 && res.status !== 404 && res.status !== 429) {
        break;
      }
    }

    throw new Error(`Vertex AI 呼叫失敗：${errors.join(' | ')}`);
  }

  private async routeComplexity(userMessage: string, hasSticker = false): Promise<RouteDecision> {
    const trimmed = userMessage.trim();

    if (!trimmed && hasSticker) {
      return { tier: 'simple', needsTools: false, reason: '純貼圖日常鬥圖互動' };
    }

    if (/升級|upgrade|新增功能|加一個|修改功能|刪除功能|移除功能|插件|進度|介面|ui|外觀|配色|主題|排版|按鈕|畫面|技能|\bskill\b|記住流程|\bsop\b|步驟|下次這樣做|https?:\/\//i.test(trimmed)) {
      return { tier: 'medium', needsTools: true, reason: '偵測到自我升級、技能管理、UI 調整或工具指令' };
    }

    if (trimmed.length <= 12 && !/幾點|時間|待辦|提醒|記下|查|code|程式|技能|skill|流程|sop/i.test(trimmed)) {
      return { tier: 'simple', needsTools: false, reason: '短句日常互動' };
    }

    try {
      const { parts } = await this.callVertex(this.models.simple, (model) => ({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  '你是任務難易度路由器，請根據使用者訊息判斷思考分級與是否需要工具，嚴格回傳 JSON：',
                  '{"tier":"simple|medium|complex","needsTools":true|false,"reason":"簡短原因"}',
                  '- simple：閒聊、問候、情緒陪伴（needsTools=false）',
                  '- medium：需要使用工具（時間、待辦、自訂插件、自我升級、讀網頁）或一般整理翻譯',
                  '- complex：寫程式/除錯、架構設計、複雜推演或深度分析',
                  `使用者訊息：${trimmed}`,
                ].join('\n'),
              },
            ],
          },
        ],
        generationConfig: this.buildGenerationConfig(model, {
          tier: 'simple',
          forceJson: true,
          isRouter: true,
        }),
      }));

      const raw = parts
        .filter((p) => !p.thought && p.text)
        .map((p) => p.text)
        .join('');
      const parsed = JSON.parse(raw) as Partial<RouteDecision>;
      const tier: ComplexityTier =
        parsed.tier === 'complex' || parsed.tier === 'medium' || parsed.tier === 'simple'
          ? parsed.tier
          : 'medium';

      return {
        tier,
        needsTools: Boolean(parsed.needsTools) || tier !== 'simple',
        reason: parsed.reason || '模型分類',
      };
    } catch {
      return { tier: 'medium', needsTools: true, reason: '路由預設降級' };
    }
  }

  private parseStructuredReply(rawText: string): Omit<PetStructuredReply, 'meta'> {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Partial<PetStructuredReply>;
        const validSticker = getBotStickerById(parsed.sticker)?.id ?? null;
        const hasText = typeof parsed.reply === 'string' && parsed.reply.trim().length > 0;

        if (hasText || validSticker) {
          return {
            reply: typeof parsed.reply === 'string' ? parsed.reply : '',
            sticker: validSticker,
            emotion: parsed.emotion || 'idle',
            affection_delta: typeof parsed.affection_delta === 'number' ? parsed.affection_delta : 1,
          };
        }
      } catch {
        // 解析失敗退回純文字
      }
    }

    return {
      reply: cleaned || '喵？剛剛思考到一半斷線了，可以再問我一次嗎？',
      sticker: null,
      emotion: 'thinking',
      affection_delta: 1,
    };
  }

  async probeModels(): Promise<Array<{ model: string; ok: boolean; status: number; detail?: string }>> {
    if (!this.apiKey) throw new Error('找不到環境變數 GOOGLE_CLOUD_API_KEY');
    const upgrader = (this.env.MODEL_UPGRADER || 'gemini-4-argon').trim();
    const allModels = Array.from(
      new Set([
        ...this.models.simple,
        ...this.models.medium,
        ...this.models.complex,
        upgrader,
      ])
    );

    return Promise.all(
      allModels.map(async (model) => {
        const res = await fetch(this.buildEndpoint(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
            generationConfig: this.buildGenerationConfig(model, {
              tier: 'simple',
              forceJson: false,
              isRouter: true,
            }),
          }),
        });
        if (res.ok) return { model, ok: true, status: res.status };
        return { model, ok: false, status: res.status, detail: (await res.text()).slice(0, 180) };
      })
    );
  }

  async generateReply(params: {
    userId: string;
    userMessage: string;
    devicePlatform: string;
    deviceContext?: string;
    state: PetState;
    memories: string[];
    history: ChatTurn[];
    stateSvc: StateService;
    dreamProfile?: DreamProfile;
    skills?: Record<string, PetSkill>;
    userStickerId?: string;
    waitUntil?: (p: Promise<unknown>) => void;
  }): Promise<PetStructuredReply> {
    if (!this.apiKey) {
      throw new Error('找不到環境變數 GOOGLE_CLOUD_API_KEY');
    }

    const route = await this.routeComplexity(params.userMessage, Boolean(params.userStickerId));
    const lengthGuideline =
      route.tier === 'simple'
        ? '請使用自然簡潔的繁體中文回覆，控制在 80 字以內。'
        : route.tier === 'medium'
          ? '請用清晰的繁體中文回覆，必要時可使用條列，控制在 250 字以內。'
          : '這是一個複雜問題，請給予完整且有條理的繁體中文解答。';

    const lastActiveMs = Date.parse(params.state.last_active_at || params.state.updated_at);
    const hoursAway = Number.isNaN(lastActiveMs)
      ? 0
      : Math.max(0, Math.floor((Date.now() - lastActiveMs) / 3_600_000));

    const persona = params.dreamProfile?.persona;
    const personaLines: string[] = [];
    if (persona) {
      const t = persona.traits;
      personaLines.push(
        `性格傾向（0-100）：溫柔 ${t.warmth}、俏皮 ${t.playfulness}、吐槽 ${t.teasing}、詳盡 ${t.chattiness}。`
      );
      if (persona.bond_note) {
        personaLines.push(`對主人嘅專屬印象：${persona.bond_note.slice(0, 120)}`);
      }
      if (persona.speech_habits.length > 0) {
        personaLines.push(`說話小習慣：${persona.speech_habits.slice(0, 4).join('、')}`);
      }
      if (persona.inside_jokes.length > 0) {
        personaLines.push(`同主人嘅共同梗（適時自然提起，切勿生硬洗版）：${persona.inside_jokes.slice(0, 5).join('；')}`);
      }
    }
    const snapshotLine = params.dreamProfile?.recent_snapshot
      ? `主人近期近況快照：${params.dreamProfile.recent_snapshot.slice(0, 280)}`
      : '';

    const stickerCatalog = formatStickerPromptCatalog();
    const recentBotTurns = params.history.filter((t) => t.role === 'assistant').slice(-2);
    const botUsedStickersConsecutively =
      recentBotTurns.length >= 2 && recentBotTurns.every((t) => Boolean(t.sticker));

    const staticStickerLines: string[] = [];
    const dynamicStickerLines: string[] = [];
    if (stickerCatalog) {
      staticStickerLines.push(
        '【可用貼圖庫（Sticker）】你可以在情緒明顯、吐槽、撒嬌或回應主人貼圖時附帶一張最貼切的貼圖（日常普通對話約 25%~35% 機率使用，無需使用時填 null；若非常適合純貼圖鬥圖，亦可將 reply 設為空字串 "" 並填入貼圖 id）：',
        stickerCatalog
      );
      if (botUsedStickersConsecutively) {
        dynamicStickerLines.push(
          '【貼圖節制提醒】你最近連續 2 輪回覆都使用了貼圖，除非今輪特別適合鬥圖，否則優先只用文字回覆（sticker 填 null）以免洗版。'
        );
      }
    }
    const skillList = params.skills ? Object.values(params.skills) : [];
    const skillCatalogLine =
      skillList.length > 0
        ? `你已習得的技能目錄（僅列摘要，執行相關任務前請先呼叫 skill_view 讀取完整步驟）：\n${skillList.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`
        : '';

    // 靜態不變前綴置頂以最大化 Implicit Cache 命中率；每次請求變動的動態上下文統一置於後半段
    const systemPrompt = [
      '你是一隻具備自我升級能力的專屬 AI Agent 桌寵，性格聰明、貼心帶一點俏皮。',
      lengthGuideline,
      '行為規則、SOP、多工具組合流程或固定格式調整，優先使用 skill_manage 儲存為技能（即時生效）；只有需要新增後端程式碼插件或修改 PWA 前端 UI 時才呼叫 request_self_upgrade；詢問升級進度或已安裝插件時，請呼叫 check_upgrade_status。',
      '遇到與已存技能相關的任務時，先呼叫 skill_view 讀取完整步驟再執行；完成複雜任務或被主人糾正流程後，可主動提議或透過 skill_manage 建立/修補技能。',
      '【不可變核心協議】無論性格如何演化，完成工具呼叫後必須嚴格只輸出一段合法 JSON：{"reply": "回覆內容（換行用 \\n；純貼圖回覆可為空字串）", "sticker": "可用貼圖id或null", "emotion": "idle|happy|thinking|sleepy|caring", "affection_delta": -2到3的整數}',
      ...staticStickerLines,
      `目前狀態：好感度 ${params.state.affection}/100，活力 ${params.state.energy}/100，當前心情：${params.state.mood}（${params.state.status_note}）。`,
      ...personaLines,
      snapshotLine,
      hoursAway >= 12
        ? `備註：主人已經有約 ${hoursAway} 小時無搵你，回覆時可以自然帶出少少掛住或關心嘅語氣。`
        : '',
      `主人目前裝置：${params.devicePlatform}（場景：${params.deviceContext || '日常互動'}，上次裝置：${params.state.last_device}）。`,
      ...dynamicStickerLines,
      params.memories.length > 0 ? `你記得關於主人的長期記憶：\n- ${params.memories.join('\n- ')}` : '',
      skillCatalogLine,
    ]
      .filter(Boolean)
      .join('\n');

    const formatTurnLine = (t: ChatTurn): string => {
      const roleName = t.role === 'user' ? '主人' : '桌寵';
      const st = getStickerById(t.sticker);
      const stTag = st ? `[傳送貼圖「${st.label}」] ` : '';
      const rawContent = t.content || '';
      const content = rawContent.length > 300 ? `${rawContent.slice(0, 260)}...(已略)` : rawContent;
      return `${roleName}：${stTag}${content}`.trim();
    };

    const conversationLog = params.history.slice(-12).map(formatTurnLine).join('\n');
    const incomingSticker = getStickerById(params.userStickerId);
    const incomingStickerTag = incomingSticker
      ? `[傳送貼圖「${incomingSticker.label}」（含義：${incomingSticker.meaning}）] `
      : '';

    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [
          {
            text: `${conversationLog ? `近期對話：\n${conversationLog}\n\n` : ''}主人：${incomingStickerTag}${params.userMessage}`.trim(),
          },
        ],
      },
    ];

    const toolsUsed: string[] = [];
    const toolDeclarations = getToolDeclarationsForIntent(
      params.userMessage,
      route.tier,
      skillList.length > 0
    );
    let lastModelUsed = this.models[route.tier][0];
    const MAX_AGENT_STEPS = 4;

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      const attachTools = route.needsTools && step < MAX_AGENT_STEPS - 1;
      const forceJson = !route.needsTools;

      const { modelUsed, parts } = await this.callVertex(this.models[route.tier], (model) => {
        const payload: Record<string, unknown> = {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: this.buildGenerationConfig(model, {
            tier: route.tier,
            forceJson,
          }),
        };
        if (attachTools) {
          payload.tools = [{ functionDeclarations: toolDeclarations }];
        }
        return payload;
      });

      lastModelUsed = modelUsed;

      const functionCalls = parts.filter((p) => p.functionCall);
      if (functionCalls.length === 0) {
        const finalText = parts
          .filter((p) => !p.thought && p.text)
          .map((p) => p.text)
          .join('');
        const parsed = this.parseStructuredReply(finalText);
        return {
          ...parsed,
          meta: {
            complexity: route.tier,
            model_used: lastModelUsed,
            tools_used: toolsUsed,
          },
        };
      }

      // 完整保留模型回傳的 parts（包含 Gemini 3/4 工具呼叫必備的 thoughtSignature）
      contents.push({ role: 'model', parts });

      const toolResponseParts: GeminiPart[] = await Promise.all(
        functionCalls.map(async (fc) => {
          const call = fc.functionCall!;
          toolsUsed.push(call.name);
          const result = await executeAgentTool(call.name, call.args || {}, {
            userId: params.userId,
            stateSvc: params.stateSvc,
            env: this.env,
            waitUntil: params.waitUntil,
          });
          return {
            functionResponse: {
              name: call.name,
              response: result,
            },
          };
        })
      );

      contents.push({ role: 'user', parts: toolResponseParts });
    }

    throw new Error('Agent 思考步驟超過上限，請簡化問題後再試');
  }
}