import type { ChatTurn } from '../types';

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
