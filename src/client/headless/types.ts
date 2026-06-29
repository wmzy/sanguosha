// src/client/headless/types.ts
// HeadlessGameClient 公开类型。框架无关（零 React 依赖）。
import type {
  GameView,
  ViewEvent,
  ClientMessage as EngineClientMessage,
  Card,
} from '../../engine/types';
import type { RoomConfig, ServerMessage } from '../../server/protocol';

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
  onView?: (view: GameView, newEvents: ViewEvent[]) => void;
  onRoomState?: (state: RoomState | null) => void;
  onPhaseChange?: (phase: ClientPhase) => void;
  onGameOver?: (winner: string) => void;
  onActionRejected?: () => void;
  onError?: (err: Error) => void;
  /** 每条原始 ServerMessage 到达后调用（供宿主做展示层增强：telemetry/判定牌延迟等）。在 view 更新之后。 */
  onMessage?: (msg: ServerMessage) => void;
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
    /** 选将询问时的候选武将列表（仅选将 pending 非空） */
    candidates?: Array<{ name: string; skills: string[] }>;
  } | null;
  zones: { deckCount: number; discardPileCount: number };
  log: { time: number; player: number; text: string }[];
}
