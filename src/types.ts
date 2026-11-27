import type { StateService } from './services';
export interface Env {
  GOOGLE_CLOUD_API_KEY: string;
  GCP_PROJECT_ID?: string;
  GCP_LOCATION?: string;
  GEMINI_MODEL?: string;
  MODEL_FAST?: string;
  MODEL_BALANCED?: string;
  MODEL_DEEP?: string;
  MODEL_UPGRADER?: string;
  MODEL_DREAMER?: string;
  GITHUB_TOKEN?: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  MEM0_API_KEY: string;
  BFF_ACCESS_TOKEN: string;
}

export type ComplexityTier = 'simple' | 'medium' | 'complex';

export type PetEmotion = 'idle' | 'happy' | 'thinking' | 'sleepy' | 'caring';

export interface RouteDecision {
  tier: ComplexityTier;
  needsTools: boolean;
  reason: string;
}

export interface StickerPayload {
  id: string;
  url: string;
  label: string;
}

export interface InteractRequest {
  user_id: string;
  device: {
    platform: 'android' | 'windows' | 'macos';
    context?: string;
  };
  input: {
    type: 'text' | 'sticker';
    content: string;
    sticker_id?: string;
  };
}

export interface PetState {
  affection: number;
  energy: number;
  mood: PetEmotion;
  status_note: string;
  last_device: string;
  last_active_at: string;
  updated_at: string;
  extra?: Record<string, unknown>;
}

export interface LifecycleContext {
  now: Date;
  hkHour: number;
  hoursSinceLastActive: number;
}

export interface PetStructuredReply {
  reply: string;
  sticker?: string | null;
  emotion: PetEmotion;
  affection_delta: number;
  meta?: {
    complexity: ComplexityTier;
    model_used: string;
    tools_used: string[];
  };
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  sticker?: string;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
}

export interface PetSkill {
  name: string;        // 限小寫英文、數字與連字號 ^[a-z0-9-]{2,40}$
  description: string; // 80 字內精簡簡介（用於 System Prompt 目錄）
  content: string;     // Markdown SOP 內容（最多 2000 字）
  tags?: string[];     // 最多 5 個標籤
  updated_at: string;
}

export interface UpgradeStatus {
  status: 'running' | 'pr_created' | 'merged' | 'rejected' | 'failed';
  step?: string;
  request: string;
  summary?: string;
  pr_url?: string;
  actions_url?: string;
  changed_files?: string[];
  logs?: string[];
  error?: string;
  started_at?: string;
  updated_at: string;
}

// 發夢記憶整理、日記與性格演化型別
export interface DreamInboxItem {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface PersonaTraits {
  warmth: number;      // 貼心溫柔度 0-100
  playfulness: number; // 俏皮撒嬌度 0-100
  teasing: number;     // 吐槽幽默度 0-100
  chattiness: number;  // 話多詳盡度 0-100
}

export interface PetPersona {
  traits: PersonaTraits;
  inside_jokes: string[];
  speech_habits: string[];
  bond_note: string;
  updated_at: string;
}

export interface PetDiaryEntry {
  date: string; // YYYY-MM-DD (HKT)
  mood: PetEmotion;
  title: string;
  content: string;
  highlights: string[];
  model_used: string;
  created_at: string;
}

export interface DreamProfile {
  persona: PetPersona;
  persona_history: PetPersona[];
  recent_snapshot: string;
  last_dream_date?: string;
  last_processed_ts: number;
  updated_at: string;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface CareLogEntry {
  id: string;
  type: 'feed' | 'game';
  itemOrGame: string;
  energyDelta: number;
  affectionDelta: number;
  energyAfter: number;
  affectionAfter: number;
  summary: string;
  timestamp: string;
}

export interface PetCareMeta {
  totalFedCount: number;
  totalGamesPlayed: number;
  lastFedAt: string | null;
  lastGameAt: string | null;
  history: CareLogEntry[];
  updatedAt: string;
}

export interface PluginContext {
  userId: string;
  stateSvc: StateService;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface PluginTool {
  declaration: ToolDeclaration;
  execute: (args: Record<string, unknown>, ctx: PluginContext) => Promise<Record<string, unknown>>;
}

declare module '*.html' {
  const content: string;
  export default content;
}

declare module '*.css' {
  const content: string;
  export default content;
}
