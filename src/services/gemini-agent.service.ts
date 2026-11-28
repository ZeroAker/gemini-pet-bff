import {
  formatStickerPromptCatalog,
  getBotStickerById,
  getStickerById,
} from '../plugins/stickers';
import { executeAgentTool, getToolDeclarationsForIntent } from '../tools';
import type {
  ChatTurn,
  ComplexityTier,
  DreamProfile,
  Env,
  PetSkill,
  PetState,
  PetStructuredReply,
  RouteDecision,
} from '../types';
import type { StateService } from './redis-state.service';

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
