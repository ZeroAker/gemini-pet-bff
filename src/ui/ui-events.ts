import type { PetEmotion, PetState, UpgradeStatus } from '../types';

/**
 * 前端 UI 模組間標準 CustomEvent 事件名稱常數
 * 各子模組可透過 `window.dispatchEvent(new CustomEvent(UI_EVENTS.XXX, { detail }))`
 * 與 `window.addEventListener(UI_EVENTS.XXX, handler)` 解耦跨模組通訊。
 */
export const UI_EVENTS = {
  /** 桌寵核心狀態（好感度、活力、無聊度、心情）更新完成 */
  PET_STATE_UPDATED: 'pet:state-updated',
  /** 使用者觸發自我升級任務 */
  UPGRADE_TRIGGERED: 'pet:upgrade-triggered',
  /** 自我升級狀態輪詢同步完成 */
  UPGRADE_STATUS_SYNCED: 'pet:upgrade-status-synced',
  /** 主動關懷或系統氣泡通知觸發 */
  PROACTIVE_BUBBLE_SHOWN: 'pet:proactive-bubble-shown',
  /** 照護餵食或小遊戲互動完成 */
  CARE_ACTION_COMPLETED: 'pet:care-action-completed',
} as const;

export type UiEventName = (typeof UI_EVENTS)[keyof typeof UI_EVENTS];

export interface PetStateUpdatedDetail {
  affection: number;
  energy: number;
  boredom: number;
  mood: PetEmotion;
  activity: string;
  statusNote: string;
  rawState?: PetState;
}

export interface UpgradeTriggeredDetail {
  promptText: string;
  startedAt: number;
}

export interface UpgradeStatusSyncedDetail {
  status: UpgradeStatus | { status: 'idle'; logs: string[] };
}

export interface CareActionCompletedDetail {
  action: 'feed' | 'play_game';
  summary: string;
  energy: number;
  affection: number;
}
