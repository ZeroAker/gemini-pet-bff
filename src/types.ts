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
  last_device: string;
  updated_at: string;
}

export interface PetStructuredReply {
  reply: string;
  emotion: 'idle' | 'happy' | 'thinking' | 'sleepy' | 'caring';
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

// 自我升級狀態記錄（存於 Upstash Redis）
export interface UpgradeStatus {
  status: 'running' | 'pr_created' | 'rejected' | 'failed';
  request: string;
  summary?: string;
  pr_url?: string;
  changed_files?: string[];
  error?: string;
  updated_at: string;
}

// 核心與插件共用的工具介面規範
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