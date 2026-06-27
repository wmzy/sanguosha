// src/client/headless/types.ts
// HeadlessGameClient 公开类型。框架无关（零 React 依赖）。
import type { GameView, ViewEvent, ClientMessage as EngineClientMessage, Card } from '../../engine/types';
import type { RoomConfig } from '../../server/protocol';

/** 配置阶段房间准备状态（由 room_state 消息驱动）。 */
export interface RoomState {
  readyPlayers: string[];
  playerIds: string[];
  hostId: string | null;
  maxPlayers: number;
  config: RoomConfig;
}

export type ClientPhase = 'connecting' | 'lobby' | 'playing' | 'ended';

export interface HeadlessCallbacks {
  /** view 每次更新（initialView 或增量 event 后）。携带自上次以来的新事件窗口 */
  onView?: (view: GameView, newEvents: ViewEvent[]) => void;
  /** 配置阶段房间状态变化 */
  onRoomState?: (state: RoomState | null) => void;
  /** 阶段切换（进入 lobby/playing/ended） */
  onPhaseChange?: (phase: ClientPhase) => void;
  /** 游戏结束 */
  onGameOver?: (winner: string) => void;
  /** 出牌被拒（CAS baseSeq 失配或 validate 失败） */
  onActionRejected?: () => void;
  /** 连接异常/断开 */
  onError?: (err: Error) => void;
}

/** AI 决策的核心输入：一个可直接执行的操作。 */
export interface AvailableAction {
  /** 人类可读描述，如 "使用【杀】(♠5) 攻击 P2" / "出【闪】响应杀" / "进入弃牌阶段(选 X 张)" */
  description: string;
  /** 预填的 ClientMessage 模板；目标类操作 targets 需 agent 补全 */
  message: EngineClientMessage;
  /** 合法目标座次列表（无目标操作为空）；cardFilter/targetFilter 已跑过 */
  validTargets: number[];
  /** 操作类别，便于 agent 分流：主动出牌 / 回应 / 弃牌 / 选将 / 转化 / 分配 */
  category: 'play' | 'respond' | 'discard' | 'selectChar' | 'transform' | 'distribute';
}

/** AI 友好的 view 投影（MCP 层用，精简 token）。见 spec §4.4 */
export interface AiViewSnapshot {
  viewer: number;
  currentPlayerIndex: number;
  phase: GameView['phase'];
  turn: { round: number };
  players: Array<{
    index: number;
    name: string;
    character: string;
    health: number;
    maxHealth: number;
    alive: boolean;
    handCount: number;
    hand?: Card[];
    equipment: GameView['players'][number]['equipment'];
    skills: string[];
    identity?: string;
  }>;
  pending: {
    target: number;
    isBlocking: boolean;
    promptTitle: string;
    requestType: string;
  } | null;
  zones: { deckCount: number; discardPileCount: number };
  log: { time: number; player: number; text: string }[];
}
