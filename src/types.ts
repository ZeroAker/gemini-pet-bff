export interface Env {
  GOOGLE_CLOUD_API_KEY: string;
  GCP_PROJECT_ID?: string;
  GCP_LOCATION?: string;
  GEMINI_MODEL?: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  MEM0_API_KEY: string;
  BFF_ACCESS_TOKEN: string;
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
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}