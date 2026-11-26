import { executeAgentTool, getAllToolDeclarations } from './tools';
import type {
  ChatTurn,
  ComplexityTier,
  Env,
  PetState,
  PetStructuredReply,
  RouteDecision,
  TodoItem,
  UpgradeStatus,
} from './types';

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

  async getUpgradeStatus(userId: string): Promise<UpgradeStatus | null> {
    const raw = await this.command<string | null>(['GET', `upgrade:${userId}`]);
    return raw ? (JSON.parse(raw) as UpgradeStatus) : null;
  }

  async saveUpgradeStatus(userId: string, status: UpgradeStatus): Promise<void> {
    await this.command(['SET', `upgrade:${userId}`, JSON.stringify(status)]);
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

  private async routeComplexity(userMessage: string): Promise<RouteDecision> {
    const trimmed = userMessage.trim();

    if (/升級|upgrade|新增功能|加一個|修改功能|刪除功能|移除功能|插件|進度|介面|ui|外觀|配色|主題|排版|按鈕|畫面|https?:\/\//i.test(trimmed)) {
      return { tier: 'medium', needsTools: true, reason: '偵測到自我升級、UI 調整或工具指令' };
    }

    if (trimmed.length <= 12 && !/幾點|時間|待辦|提醒|記下|查|code|程式/i.test(trimmed)) {
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
        if (parsed.reply) {
          return {
            reply: parsed.reply,
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
    waitUntil?: (p: Promise<unknown>) => void;
  }): Promise<PetStructuredReply> {
    if (!this.apiKey) {
      throw new Error('找不到環境變數 GOOGLE_CLOUD_API_KEY');
    }

    const route = await this.routeComplexity(params.userMessage);
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

    const systemPrompt = [
      '你是一隻具備自我升級能力的專屬 AI Agent 桌寵，性格聰明、貼心帶一點俏皮。',
      lengthGuideline,
      `目前狀態：好感度 ${params.state.affection}/100，活力 ${params.state.energy}/100，當前心情：${params.state.mood}（${params.state.status_note}）。`,
      hoursAway >= 12
        ? `備註：主人已經有約 ${hoursAway} 小時無搵你，回覆時可以自然帶出少少掛住或關心嘅語氣。`
        : '',
      `主人目前裝置：${params.devicePlatform}（場景：${params.deviceContext || '日常互動'}，上次裝置：${params.state.last_device}）。`,
      params.memories.length > 0 ? `你記得關於主人的長期記憶：\n- ${params.memories.join('\n- ')}` : '',
      '當主人要求你新增、修改、改善或刪除自身功能（包含生理時鐘作息規則或 PWA 介面）時，請呼叫 request_self_upgrade 工具；詢問升級進度或已安裝插件時，請呼叫 check_upgrade_status。',
      '完成工具呼叫後，請嚴格只輸出一段合法 JSON：{"reply": "回覆內容（換行用 \\n）", "emotion": "idle|happy|thinking|sleepy|caring", "affection_delta": -2到3的整數}',
    ]
      .filter(Boolean)
      .join('\n');

    const conversationLog = params.history
      .map((t) => `${t.role === 'user' ? '主人' : '桌寵'}：${t.content}`)
      .join('\n');

    const contents: GeminiContent[] = [
      {
        role: 'user',
        parts: [
          {
            text: `${conversationLog ? `近期對話：\n${conversationLog}\n\n` : ''}主人：${params.userMessage}`,
          },
        ],
      },
    ];

    const toolsUsed: string[] = [];
    const allToolDeclarations = getAllToolDeclarations();
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
          payload.tools = [{ functionDeclarations: allToolDeclarations }];
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