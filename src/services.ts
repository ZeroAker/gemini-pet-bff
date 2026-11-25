import { AGENT_TOOL_DECLARATIONS, executeAgentTool } from './tools';
import type {
  ChatTurn,
  ComplexityTier,
  Env,
  PetState,
  PetStructuredReply,
  RouteDecision,
  TodoItem,
} from './types';

// 1. Upstash Redis：管理短期對話快取、好感度狀態、待辦清單與跨裝置鎖
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
    const raw = await this.command<string | null>(['GET', `state:${userId}`]);
    if (raw) return JSON.parse(raw) as PetState;
    return { affection: 50, energy: 80, last_device: 'unknown', updated_at: new Date().toISOString() };
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
}

// 2. Mem0：跨裝置長期記憶檢索與自動提煉
export class MemoryService {
  constructor(private apiKey: string) {}

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

// 3. Google Cloud Vertex AI（動態模型路由 + Agent 工具迴圈）
interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export class GeminiService {
  private apiKey: string;
  private projectId: string;
  private location: string;
  private models: Record<ComplexityTier, string[]>;

  constructor(env: Env) {
    this.apiKey = (env.GOOGLE_CLOUD_API_KEY || '').trim();
    this.projectId = (env.GCP_PROJECT_ID || '').trim();
    this.location = (env.GCP_LOCATION || 'global').trim();

    const fast = (env.MODEL_FAST || 'gemini-2.5-flash-lite').trim();
    const balanced = (env.MODEL_BALANCED || env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
    const deep = (env.MODEL_DEEP || 'gemini-2.5-pro').trim();

    // 每個分級都設定自動降級順序，確保不會因單一模型配額/404而報錯
    this.models = {
      simple: Array.from(new Set([fast, balanced])),
      medium: Array.from(new Set([balanced, fast])),
      complex: Array.from(new Set([deep, balanced, fast])),
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

  private async callVertex(
    candidateModels: string[],
    payload: Record<string, unknown>
  ): Promise<{ modelUsed: string; parts: GeminiPart[] }> {
    const errors: string[] = [];

    for (const model of candidateModels) {
      const res = await fetch(this.buildEndpoint(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
      // 404(模型不可用) 或 429(頻率受限) 自動降級嘗試下一個模型
      if (res.status !== 404 && res.status !== 429) {
        break;
      }
    }

    throw new Error(`Vertex AI 呼叫失敗：${errors.join(' | ')}`);
  }

  // 步驟 A：動態複雜度路由器
  private async routeComplexity(userMessage: string): Promise<RouteDecision> {
    const trimmed = userMessage.trim();

    // 1. 規則快篩：超短打招呼直接走 simple（省一次 API 呼叫）
    if (trimmed.length <= 12 && !/幾點|時間|待辦|提醒|記下|http|幫我查|code|程式/i.test(trimmed)) {
      return { tier: 'simple', needsTools: false, reason: '短句日常互動' };
    }

    // 2. 帶網址或明確待辦/時間指令，直接啟用工具
    if (/https?:\/\//i.test(trimmed)) {
      return { tier: 'medium', needsTools: true, reason: '包含網址需讀取網頁' };
    }

    // 3. 使用輕量模型極速分類
    try {
      const { parts } = await this.callVertex(this.models.simple, {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  '你是任務難易度路由器，請根據使用者訊息判斷思考分級與是否需要工具，嚴格回傳 JSON：',
                  '{"tier":"simple|medium|complex","needsTools":true|false,"reason":"簡短原因"}',
                  '規則：',
                  '- simple：閒聊、問候、情緒陪伴、簡單常識（needsTools=false）',
                  '- medium：需要查時間、管理待辦清單/提醒、讀網頁、一般整理或翻譯',
                  '- complex：寫程式/除錯、系統架構設計、複雜邏輯推演、長篇分析或深度規劃',
                  `使用者訊息：${trimmed}`,
                ].join('\n'),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
          maxOutputTokens: 80,
        },
      });

      const raw = parts.map((p) => p.text || '').join('');
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
      // 路由器異常時安全退回 medium
      return { tier: 'medium', needsTools: true, reason: '路由預設降級' };
    }
  }

  // 安全解析最終 JSON（避免模型加上 ```json 標籤導致 JSON.parse 崩潰）
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
        // 解析失敗則退回純文字模式
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
    const allModels = Array.from(
      new Set([...this.models.simple, ...this.models.medium, ...this.models.complex])
    );

    return Promise.all(
      allModels.map(async (model) => {
        const res = await fetch(this.buildEndpoint(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
            generationConfig: { maxOutputTokens: 8 },
          }),
        });
        if (res.ok) return { model, ok: true, status: res.status };
        return { model, ok: false, status: res.status, detail: (await res.text()).slice(0, 180) };
      })
    );
  }

  // 步驟 B：執行 Agent 主迴圈
  async generateReply(params: {
    userId: string;
    userMessage: string;
    devicePlatform: string;
    deviceContext?: string;
    state: PetState;
    memories: string[];
    history: ChatTurn[];
    stateSvc: StateService;
  }): Promise<PetStructuredReply> {
    if (!this.apiKey) {
      throw new Error('找不到環境變數 GOOGLE_CLOUD_API_KEY');
    }

    const route = await this.routeComplexity(params.userMessage);
    const lengthGuideline =
      route.tier === 'simple'
        ? '請使用自然簡潔的繁體中文回覆，控制在 80 字以內（適合桌面氣泡框）。'
        : route.tier === 'medium'
          ? '請用清晰的繁體中文回覆，必要時可使用條列，控制在 250 字以內。'
          : '這是一個複雜問題，請發揮專業能力給予完整、有條理的繁體中文解答（保留一點桌寵的親切口吻，但不必刻意壓縮字數）。';

    const systemPrompt = [
      '你是一隻陪伴在主人電腦與手機螢幕上的專屬 AI Agent 桌寵，性格聰明、貼心帶一點俏皮。',
      lengthGuideline,
      `目前狀態：好感度 ${params.state.affection}/100，活力 ${params.state.energy}/100。`,
      `主人目前裝置：${params.devicePlatform}（場景：${params.deviceContext || '日常互動'}，上次裝置：${params.state.last_device}）。`,
      params.memories.length > 0 ? `你記得關於主人的長期記憶：\n- ${params.memories.join('\n- ')}` : '',
      '若需要查詢現在時間、管理主人的跨裝置待辦清單或讀取網址內容，請優先呼叫對應工具，不要憑空猜測。',
      '當你完成所有工具呼叫並準備給主人最終答覆時，請嚴格只輸出一段合法 JSON（不要加多餘前後文）：',
      '{"reply": "你的回覆內容（換行請用 \\n）", "emotion": "idle|happy|thinking|sleepy|caring", "affection_delta": -2到3之間的整數}',
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
    let lastModelUsed = this.models[route.tier][0];
    const MAX_AGENT_STEPS = 4;

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      const payload: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: route.tier === 'complex' ? 0.4 : 0.7,
        },
      };

      // 只有需要工具且尚未到達最後一輪時掛載 tools；單純閒聊時開啟強制 JSON 輸出
      if (route.needsTools && step < MAX_AGENT_STEPS - 1) {
        payload.tools = [{ functionDeclarations: AGENT_TOOL_DECLARATIONS }];
      } else if (!route.needsTools) {
        (payload.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
      }

      const { modelUsed, parts } = await this.callVertex(this.models[route.tier], payload);
      lastModelUsed = modelUsed;

      const functionCalls = parts.filter((p) => p.functionCall);

      // 若沒有工具呼叫，代表模型已產出最終答覆
      if (functionCalls.length === 0) {
        const finalText = parts.map((p) => p.text || '').join('');
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

      // 將模型的工具呼叫意圖加入對話上下文
      contents.push({ role: 'model', parts });

      // 並行執行模型要求的所有工具
      const toolResponseParts: GeminiPart[] = await Promise.all(
        functionCalls.map(async (fc) => {
          const call = fc.functionCall!;
          toolsUsed.push(call.name);
          const result = await executeAgentTool(call.name, call.args || {}, {
            userId: params.userId,
            stateSvc: params.stateSvc,
          });
          return {
            functionResponse: {
              name: call.name,
              response: result,
            },
          };
        })
      );

      // 把工具執行結果送回給模型繼續下一輪思考
      contents.push({ role: 'user', parts: toolResponseParts });
    }

    throw new Error('Agent 思考步驟超過上限，請簡化問題後再試');
  }
}