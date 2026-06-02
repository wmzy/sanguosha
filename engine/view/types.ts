// engine/view/types.ts — 前端视角视图类型
//
// 服务端在 initialView 消息中发送 PlayerView，客户端用 reducer 维护 FrontendState。
// FrontendState 与服务器内部 GameState 是不同抽象层：GameState 包含所有隐藏信息
// （其他玩家手牌等），PlayerView 是 GameState 在某玩家视角下的"过滤"投影。

import type { CardType, CardSubType } from '../../shared/types';
import type { PendingAction, Json } from '../types';

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

export interface EquipmentView {
  weapon: CardInfo | null;
  armor: CardInfo | null;
  mount: CardInfo | null;
}

export interface SelfView {
  /** 角色 ID（如 "曹操"），用于渲染角色名/技能。 */
  characterId: string;
  hand: CardInfo[];
  equipment: EquipmentView;
  health: number;
  maxHealth: number;
  pendingTricks: PendingTrickInfo[];
  tags: string[];
  vars: Record<string, unknown>;
  alive: boolean;
}

export interface OtherPlayerView {
  /** 角色 ID（如 "曹操"），用于渲染角色名/技能。 */
  characterId: string;
  handCount: number;
  equipment: EquipmentView;
  health: number;
  maxHealth: number;
  pendingTrickCount: number;
  alive: boolean;
}

interface PendingTrickInfo {
  name: string;
  source: string;
  cardId: string;
}

export interface TableView {
  discardPileCount: number;
  deckCount: number;
}

export interface TurnView {
  phase: string;
  currentPlayer: string;
  killsPlayed: number;
}

export interface PlayerView {
  /** 共享卡牌元数据：所有可见的 CardInfo（手牌/装备/弃牌堆等）。 */
  cardMap: Record<string, CardInfo>;
  self: SelfView;
  others: Record<string, OtherPlayerView>;
  table: TableView;
  turn: TurnView;
  pending: PendingAction | null;
}

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

export interface FrontendState {
  view: PlayerView;
  myPlayerId: string;
  animationQueue: Animation[];
}

export interface AvailableAction {
  type: 'playCard' | 'useSkill' | 'respond' | 'discard';
  sourceId?: string;
  validTargets: string[];
  required: boolean;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export type { PendingAction, Json };
