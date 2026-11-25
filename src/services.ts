import type { ChatTurn, Env, PetState, PetStructuredReply } from './types';

// 1. Upstash Redis：管理短期對話快取、好感度狀態與跨裝置鎖
export class StateService {
  constructor(private url: string, private token: string) {}

  private async command<T>(args: (string | number)[]): Promise<T> {
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
    const res = await this.command<string | null>(['SET', `lock:${userId}`, '1', 'EX', 15, 'NX']);
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
}

// 2. Mem0：跨裝置長期記憶檢索與自動提煉
export class MemoryService {
  constructor(private apiKey: string) {}

  async searchMemories(userId: string, query: string): Promise<string[]> {
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

// 3. Google Cloud Vertex AI（原生 fetch + API Key 直連版）
export class GeminiService {
  private apiKey: string;
  private model: string;

  constructor(env: Env) {
    this.apiKey = (env.GOOGLE_CLOUD_API_KEY || '').trim();
    this.model = (env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  }

  async generateReply(params: {
    userMessage: string;
    devicePlatform: string;
    deviceContext?: string;
    state: PetState;
    memories: string[];
    history: ChatTurn[];
  }): Promise<PetStructuredReply> {
    if (!this.apiKey) {
      throw new Error('找不到環境變數 GOOGLE_CLOUD_API_KEY，請確認 Cloudflare Variables 已設定並重新部署');
    }

    const systemPrompt = [
      '你是一隻陪伴在主人電腦與手機螢幕上的專屬 AI 桌寵，性格聰明、貼心帶一點俏皮。',
      '請使用自然簡潔的繁體中文回覆（控制在 80 字以內，適合桌面氣泡框閱讀）。',
      `目前狀態：好感度 ${params.state.affection}/100，活力 ${params.state.energy}/100。`,
      `主人目前裝置：${params.devicePlatform}（場景：${params.deviceContext || '日常互動'}，上次裝置：${params.state.last_device}）。`,
      params.memories.length > 0 ? `你記得關於主人的長期記憶：\n- ${params.memories.join('\n- ')}` : '',
      '你必須嚴格回傳 JSON 格式：{"reply": "對話內容", "emotion": "idle|happy|thinking|sleepy|caring", "affection_delta": -2到3之間的整數}',
    ]
      .filter(Boolean)
      .join('\n');

    const conversationLog = params.history
      .map((t) => `${t.role === 'user' ? '主人' : '桌寵'}：${t.content}`)
      .join('\n');

    const prompt = `${conversationLog ? `近期對話：\n${conversationLog}\n\n` : ''}主人：${params.userMessage}`;

    const endpoint = `https://aiplatform.googleapis.com/v1/publishers/google/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Google Cloud 回應錯誤 (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(rawText) as Partial<PetStructuredReply>;

    return {
      reply: parsed.reply || '喵？剛剛訊號好像閃了一下，再跟我說一次吧！',
      emotion: parsed.emotion || 'idle',
      affection_delta: typeof parsed.affection_delta === 'number' ? parsed.affection_delta : 1,
    };
  }
}