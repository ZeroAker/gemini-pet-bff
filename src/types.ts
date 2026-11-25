export interface Env {
  GOOGLE_CLOUD_API_KEY: string;
  GCP_PROJECT_ID?: string;
  GCP_LOCATION?: string;
  GEMINI_MODEL?: string;
  MODEL_FAST?: string;
  MODEL_BALANCED?: string;
  MODEL_DEEP?: string;
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