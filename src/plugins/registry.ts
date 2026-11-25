import type { PluginTool } from '../types';
import { githubActionsUpgradeStatusPlugin } from './github-actions-upgrade-status';
import { proactiveMessagesPlugin } from './proactive-messages';

// 此清單由 Gemini 4 Neon 自我升級系統自動維護，請勿刪除本檔案
export const CUSTOM_PLUGINS: PluginTool[] = [
  githubActionsUpgradeStatusPlugin,
  proactiveMessagesPlugin,
];
