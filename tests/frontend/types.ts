import type { CardType, CardSubType } from '@shared/types';
import type { PendingAction, Json } from '@engine/types';

// ─── 前端视角视图 ─────────────────────────────────────────

/** 玩家视角看到的自己信息 */
export interface SelfView {
  hand: CardInfo[];
  equipment: EquipmentView;
  health: number;
  maxHealth: number;
  pendingTricks: PendingTrickInfo[];
  tags: string[];
  vars: Record<string, unknown>;
  alive: boolean;
}

/** 玩家视角看到的其他人信息（信息受限） */
export interface OtherPlayerView {
  handCount: number;
  equipment: { weapon: string | null; armor: string | null; mount: string | null };
  health: number;
  maxHealth: number;
  pendingTrickCount: number;
  alive: boolean;
}

/** 装备区视图 */
export interface EquipmentView {
  weapon: CardInfo | null;
  armor: CardInfo | null;
  mount: CardInfo | null;
}

/** 卡牌信息（前端可见字段） */
export interface CardInfo {
  [key: string]: Json;
  id: string;
  name: string;
  type: CardType;
  subtype: CardSubType;
  suit: string;
  rank: string;
  description: string;
}

/** 延时锦囊信息 */
interface PendingTrickInfo {
  name: string;
  source: string;
  cardId: string;
}

/** 桌面公共信息 */
export interface TableView {
  discardPileCount: number;
  deckCount: number;
}

/** 回合信息 */
export interface TurnView {
  phase: string;
  currentPlayer: string;
  killsPlayed: number;
}

/** 单个玩家的完整视角 */
export interface PlayerView {
  self: SelfView;
  others: Record<string, OtherPlayerView>;
  table: TableView;
  turn: TurnView;
}

// ─── 动画指令 ─────────────────────────────────────────────

export type Animation =
  | { type: 'cardMove'; cardId: string; from: { zone: string; player?: string }; to: { zone: string; player?: string }; duration: number }
  | { type: 'cardFlip'; cardId: string }
  | { type: 'damagePopup'; target: string; amount: number }
  | { type: 'healGlow'; target: string; amount: number }
  | { type: 'drawCards'; player: string; count: number }
  | { type: 'discardCards'; player: string; cardIds: string[] }
  | { type: 'equipItem'; player: string; cardId: string; slot: string }
  | { type: 'unequipItem'; player: string; slot: string }
  | { type: 'death'; player: string }
  | { type: 'skillActivate'; player: string; skillId: string }
  | { type: 'pendingPrompt'; actionType: string }
  | { type: 'trickReveal'; cardId: string; result: 'success' | 'fail' }
  | { type: 'nextPlayer'; player: string };

// ─── 可用操作 ─────────────────────────────────────────────

export interface AvailableAction {
  type: 'playCard' | 'useSkill' | 'respond' | 'discard';
  sourceId?: string;
  validTargets: string[];
  required: boolean;
}

// ─── 前端整体状态 ─────────────────────────────────────────

export interface FrontendState {
  views: Record<string, PlayerView>;
  myPlayerId: string;
  animationQueue: Animation[];
  pending: PendingAction | null;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };
