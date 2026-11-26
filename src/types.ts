export interface Env {
  GOOGLE_CLOUD_API_KEY: string;
  GCP_PROJECT_ID?: string;
  GCP_LOCATION?: string;
  GEMINI_MODEL?: string;
  MODEL_FAST?: string;
  MODEL_BALANCED?: string;
  MODEL_DEEP?: string;
  MODEL_UPGRADER?: string;
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

export interface InteractRequest {
  user_id: string;
  device: {
    platform: 'android' | 'windows' | 'macos';
    context?: string;
  };
  input: {
    type: 'text';
    content: string;
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
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
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
  execute: (args: Record<string, unknown>, ctx: { userId: string }) => Promise<Record<string, unknown>>;
}