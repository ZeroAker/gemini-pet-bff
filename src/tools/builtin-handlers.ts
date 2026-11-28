import type { StateService } from '../services';
import type { Env, PluginTool } from '../types';
import { SelfUpgradeService } from '../upgrader';

export interface BuiltinToolContext {
  userId: string;
  stateSvc: StateService;
  env: Env;
  waitUntil?: (p: Promise<unknown>) => void;
}

export async function executeBuiltinTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BuiltinToolContext,
  installedPlugins: PluginTool[]
): Promise<Record<string, unknown> | null> {
  if (name === 'get_current_time') {
    const formatted = new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
    return { current_time: formatted, timezone: 'Asia/Hong_Kong (UTC+8)' };
  }

  if (name === 'manage_todos') {
    const action = String(args.action || 'list');
    const todos = await ctx.stateSvc.getTodos(ctx.userId);
    if (action === 'list') return { todos, count: todos.length };
    if (action === 'add') {
      const text = String(args.text || '').trim();
      if (!text) return { error: '缺少待辦內容 text' };
      const newItem = {
        id: String(Date.now()).slice(-4),
        text,
        done: false,
        created_at: new Date().toISOString(),
      };
      todos.push(newItem);
      await ctx.stateSvc.saveTodos(ctx.userId, todos);
      return { status: 'added', item: newItem };
    }
    if (action === 'complete') {
      const id = String(args.id || '');
      const target = todos.find((t) => t.id === id);
      if (!target) return { error: `找不到 ID 為 ${id} 的待辦事項`, todos };
      target.done = true;
      await ctx.stateSvc.saveTodos(ctx.userId, todos);
      return { status: 'completed', item: target };
    }
    if (action === 'delete') {
      const id = String(args.id || '');
      const filtered = todos.filter((t) => t.id !== id);
      await ctx.stateSvc.saveTodos(ctx.userId, filtered);
      return { status: 'deleted', remaining: filtered.length };
    }
    return { error: `不支援的 action: ${action}` };
  }

  if (name === 'fetch_webpage') {
    const url = String(args.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return { error: '無效的網址格式' };
    const res = await fetch(url, { headers: { 'User-Agent': 'GeminiPetAgent/1.0' } });
    if (!res.ok) return { error: `無法存取網頁，狀態碼 ${res.status}` };
    const html = await res.text();
    const cleanText = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3500);
    return { url, content_excerpt: cleanText };
  }

  if (name === 'request_self_upgrade') {
    const instruction = String(args.instruction || '').trim();
    if (!instruction) return { error: '請提供具體的升級需求說明' };

    const upgrader = new SelfUpgradeService(ctx.env);
    return await upgrader.dispatchUpgradeJob(ctx.userId, instruction, ctx.stateSvc);
  }

  if (name === 'check_upgrade_status') {
    const latest = await ctx.stateSvc.getUpgradeStatus(ctx.userId);
    return {
      latest_upgrade: latest || '尚無升級紀錄',
      installed_custom_plugins: installedPlugins.map((p) => ({
        name: p.declaration.name,
        description: p.declaration.description,
      })),
    };
  }

  if (name === 'skill_view') {
    const skillName = String(args.name || '').trim().toLowerCase();
    if (!skillName) {
      const all = await ctx.stateSvc.getSkills(ctx.userId);
      return { error: '請提供技能名稱 name', available_skills: Object.keys(all) };
    }
    const found = await ctx.stateSvc.getSkill(ctx.userId, skillName);
    if (!found) {
      const all = await ctx.stateSvc.getSkills(ctx.userId);
      return {
        ok: false,
        error: `找不到技能「${skillName}」`,
        available_skills: Object.keys(all),
      };
    }
    return { ok: true, skill: found };
  }

  if (name === 'skill_manage') {
    const action = String(args.action || 'list').trim().toLowerCase();
    if (action === 'list') {
      const all = await ctx.stateSvc.getSkills(ctx.userId);
      const list = Object.values(all).map((s) => ({
        name: s.name,
        description: s.description,
        tags: s.tags ?? [],
        updated_at: s.updated_at,
      }));
      return { ok: true, count: list.length, skills: list };
    }

    if (action === 'create') {
      const skillName = String(args.name || '').trim().toLowerCase();
      const description = String(args.description || '').trim();
      const content = String(args.content || '').trim();
      const rawTags = args.tags;
      const tags = Array.isArray(rawTags)
        ? rawTags.map((t) => String(t).trim()).filter(Boolean)
        : typeof rawTags === 'string'
          ? rawTags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined;
      return await ctx.stateSvc.upsertSkill(ctx.userId, {
        name: skillName,
        description,
        content,
        tags,
      });
    }

    if (action === 'patch') {
      const skillName = String(args.name || '').trim().toLowerCase();
      const search = typeof args.search === 'string' ? args.search : '';
      const replace = typeof args.replace === 'string' ? args.replace : '';
      return await ctx.stateSvc.patchSkill(ctx.userId, skillName, search, replace);
    }

    if (action === 'delete') {
      const skillName = String(args.name || '').trim().toLowerCase();
      return await ctx.stateSvc.deleteSkill(ctx.userId, skillName);
    }

    return { ok: false, error: `不支援的 skill_manage action: ${action}` };
  }

  return null;
}
