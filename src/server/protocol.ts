// src/server/protocol.ts
// 服务端协议层 — 事件流广播。
// 每次 atom apply 后,服务端逐条发送 event 消息给该 viewer 可见的事件。
// 断线重连:拉 initialView baseline(全量 GameView),之后继续推 event。
// viewer 由 WS 连接标识,不需要在消息中携带。
import type {
  ClientMessage as EngineClientMessage,
  GameView,
  Json,
  ViewEvent,
} from '../engine/types';
export type { GameEventEnvelope } from '../engine/types';

export type EventSeq = number;

/** 将池预设 */
export type CharPoolPreset = 'standard' | 'extended' | 'all';

/** 聊天配置。房主在等待大厅设置，增加游戏趣味性(暗示/欺骗等)。 */
export interface ChatConfig {
  /** 是否开启聊天 */
  enabled: boolean;
  /** 是否只能发送白名单内的消息(限制直白沟通，增加暗示/欺骗策略) */
  whitelistOnly: boolean;
  /** 白名单消息列表 */
  whitelist: string[];
  /** 每人每局最多消息数 (0=无限) */
  maxPerGame: number;
  /** 每人每分钟最多消息数 (0=无限) */
  maxPerMinute: number;
  /** 每条消息最大字数 (0=无限) */
  maxChars: number;
}

/** 默认白名单短语(暗示/欺骗类，增加策略深度) */
export const DEFAULT_CHAT_WHITELIST: string[] = [
  '我有杀', '我没有杀',
  '我有闪', '我没有闪',
  '我有桃', '我没有桃',
  '我手牌很多', '我手牌不多',
  '集火他', '保护我',
  '别打我', '小心',
  '信任我', '别信他',
  '快出牌', '再等等',
  '注意他', '我帮不了',
  '我来帮忙', '先杀他',
];

/** 默认聊天配置 */
export const DEFAULT_CHAT_CONFIG: ChatConfig = {
  enabled: true,
  whitelistOnly: false,
  whitelist: [...DEFAULT_CHAT_WHITELIST],
  maxPerGame: 0,
  maxPerMinute: 5,
  maxChars: 30,
};

/** 房间级游戏配置(调试/普通房间通用)。在 startGame 时传给引擎。 */
export interface RoomConfig {
  /** 房间名 */
  name: string;
  /** 出牌/操作倒计时倍率。1=默认; <1 更快; >1 更慢; Infinity=无限 */
  timeoutScale: number;
  /** 将池预设 */
  charPool: CharPoolPreset;
  /** 每人初始手牌数(默认 4) */
  handSize: number;
  /** 聊天配置 */
  chat: ChatConfig;
}

/** 默认房间配置 */
export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  name: '调试房间',
  timeoutScale: 1,
  charPool: 'all',
  handSize: 4,
  chat: { ...DEFAULT_CHAT_CONFIG },
};

/** 校验并规范化 ChatConfig:修正非法字段为默认值。 */
export function normalizeChatConfig(raw: unknown): ChatConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const enabled =
    typeof r['enabled'] === 'boolean' ? r['enabled'] : DEFAULT_CHAT_CONFIG.enabled;
  const whitelistOnly =
    typeof r['whitelistOnly'] === 'boolean'
      ? r['whitelistOnly']
      : DEFAULT_CHAT_CONFIG.whitelistOnly;
  const whitelist =
    Array.isArray(r['whitelist']) && r['whitelist'].every((s) => typeof s === 'string')
      ? (r['whitelist'] as string[])
          .map((s) => s.trim().slice(0, 50))
          .filter((s) => s.length > 0)
          .slice(0, 100)
      : [...DEFAULT_CHAT_WHITELIST];
  const maxPerGame =
    typeof r['maxPerGame'] === 'number' && r['maxPerGame'] >= 0 && r['maxPerGame'] <= 999
      ? Math.floor(r['maxPerGame'])
      : DEFAULT_CHAT_CONFIG.maxPerGame;
  const maxPerMinute =
    typeof r['maxPerMinute'] === 'number' && r['maxPerMinute'] >= 0 && r['maxPerMinute'] <= 999
      ? Math.floor(r['maxPerMinute'])
      : DEFAULT_CHAT_CONFIG.maxPerMinute;
  const maxChars =
    typeof r['maxChars'] === 'number' && r['maxChars'] >= 0 && r['maxChars'] <= 200
      ? Math.floor(r['maxChars'])
      : DEFAULT_CHAT_CONFIG.maxChars;
  return { enabled, whitelistOnly, whitelist, maxPerGame, maxPerMinute, maxChars };
}

/** 校验并规范化 RoomConfig:修正非法字段为默认值。 */
export function normalizeRoomConfig(raw: unknown): RoomConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name =
    typeof r['name'] === 'string' && r['name'].trim()
      ? r['name'].trim().slice(0, 40)
      : DEFAULT_ROOM_CONFIG.name;
  let timeoutScale =
    typeof r['timeoutScale'] === 'number' && r['timeoutScale'] > 0
      ? r['timeoutScale']
      : DEFAULT_ROOM_CONFIG.timeoutScale;
  if (!Number.isFinite(timeoutScale) || timeoutScale > 1000) timeoutScale = Infinity;
  const charPool: CharPoolPreset =
    r['charPool'] === 'standard' || r['charPool'] === 'extended' || r['charPool'] === 'all'
      ? r['charPool']
      : DEFAULT_ROOM_CONFIG.charPool;
  const handSize =
    typeof r['handSize'] === 'number' && r['handSize'] >= 0 && r['handSize'] <= 20
      ? Math.floor(r['handSize'])
      : DEFAULT_ROOM_CONFIG.handSize;
  const chat = r['chat'] !== undefined ? normalizeChatConfig(r['chat']) : { ...DEFAULT_CHAT_CONFIG };
  return { name, timeoutScale, charPool, handSize, chat };
}

/** 倒计时信息(pending 优先,否则出牌/弃牌阶段的 idleDeadline)。
 *  仅在 deadline 变化时附在 event 消息上,减少冗余传输。 */
export interface DeadlineInfo {
  /** 截止时间戳(绝对,Date.now() 口径) */
  deadline: number;
  /** 倒计时总时长(ms) */
  totalMs: number;
}

/**
 * 服务端发往客户端的消息。
 * - initialView: 全量 baseline(首次/重连),viewer 隔离的 GameView。
 *   debug 多 WS 模型下,每个座次是独立连接,各自收自己 viewer 的 initialView。
 * - event: 单个事件。每次 atom apply / pending resolve 后逐条发送。
 *   viewer 由 WS 连接标识,不在消息中携带。
 *   view: 视图事件(atom apply)。notify: 通知事件(pendingResolved 等)。
 *   一条 event 消息通常只含 view 或 notify 之一;服务端按 seq 顺序逐条发。
 *   effect 不下发,前端通过 AtomDefinition.effect 静态查表。
 *   deadline 仅在变化时附加(合并了 pending deadline 和 turn idle deadline)。
 */
export type ServerMessage =
  | { type: 'initialView'; state: GameView; lastSeq: EventSeq }
  | {
      type: 'event';
      seq: EventSeq;
      timestamp: number;
      view?: ViewEvent;
      notify?: { skillId: string; eventType: string; data: Json };
      deadline?: DeadlineInfo | null;
    }
  | { type: 'error'; message: string }
  | { type: 'actionRejected' }
  | { type: 'gameOver'; winner: string }
  | { type: 'game_reset' }
  | { type: 'room_joined'; roomId: string; playerId: string; seatIndex?: number }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
  | { type: 'player_disconnected'; playerId: string; graceMs: number }
  | { type: 'player_reconnected'; playerId: string }
  | { type: 'game_started' }
  | { type: 'room_config'; config: RoomConfig }
  | {
      type: 'room_state';
      readyPlayers: string[];
      playerIds: string[];
      hostId: string | null;
      maxPlayers: number;
      config: RoomConfig;
      spectatorIds: string[];
      viewGrants: Record<string, number>;
      pendingViewRequests: Record<string, number>;
      roomType?: 'normal' | 'quick';
      seats: (string | null)[];
      pendingSeatSwaps: Record<string, { targetSeat: number; expiresAt: number }>;
    }
  | { type: 'player_ready'; playerId: string }
  | { type: 'spectator_joined'; spectatorId: string }
  | { type: 'spectator_left'; spectatorId: string }
  | { type: 'view_request'; spectatorId: string; targetSeat: number }
  | { type: 'view_granted'; spectatorId: string; seatIndex: number }
  | { type: 'view_revoked'; spectatorId: string }
  | { type: 'role_changed'; playerId: string; newRole: 'player' | 'spectator' }
  | { type: 'chat'; playerId: string; seatIndex: number; text: string; timestamp: number }
  | { type: 'chat_history'; messages: Array<{ playerId: string; seatIndex: number; text: string; timestamp: number }> }
  | { type: 'seat_swap_request'; requesterId: string; requesterSeat: number; targetSeat: number; targetPlayerId: string; expiresAt: number }
  | { type: 'seat_swap_result'; success: boolean; requesterId: string; responderId: string }

/**
 * 客户端发往服务端的消息。
 * 'action' 类型携带新 ENGINE-DESIGN 的 ClientMessage { skillId, actionType, ownerId, params, baseSeq }。
 * 主动 / 回应 action 都走这个形状。
 */
export type ClientMessage =
  | { type: 'action'; action: EngineClientMessage; baseSeq: EventSeq }
  | { type: 'reorder_hand'; order: string[] }
  | { type: 'ready' }
  | { type: 'join_room'; roomId: string }
  | { type: 'create_room'; name: string; maxPlayers: number; config?: RoomConfig }
  | { type: 'join_debug_room'; roomId: string; lastSeq?: EventSeq }
  | { type: 'start_game' }
  | { type: 'restart_game' }
  | { type: 'leave_room' }
  | { type: 'reconnect'; playerId: string; lastSeq?: EventSeq }
  | { type: 'create_debug_room'; config?: RoomConfig; playerCount?: number }
  | { type: 'update_room_config'; config: RoomConfig }
  | { type: 'set_player_id'; playerId: string };

export interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  status: string;
  /** 房主 playerId;debug 房间无房主时为 null */
  hostId?: string | null;
  isDebug?: boolean;
  /** 房间类型: normal=持久化; quick=纯内存 */
  roomType?: 'normal' | 'quick';
  config?: RoomConfig;
  spectatorCount?: number;
}

export function isValidClientMessage(data: unknown): data is ClientMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  const t = d['type'];
  switch (t) {
    case 'action':
      return typeof d['baseSeq'] === 'number' && isValidEngineClientMessage(d['action']);
    case 'reorder_hand': {
      const order = d['order'];
      return Array.isArray(order) && order.every((id: unknown) => typeof id === 'string');
    }
    case 'ready':
    case 'start_game':
    case 'restart_game':
    case 'leave_room':
      return true;
    case 'set_player_id':
      return typeof d['playerId'] === 'string' && d['playerId'].length > 0;
    case 'join_room':
    case 'join_debug_room':
      return typeof d['roomId'] === 'string';
    case 'reconnect':
      return typeof d['playerId'] === 'string';
    case 'create_room':
      return typeof d['name'] === 'string' && typeof d['maxPlayers'] === 'number';
    case 'create_debug_room':
      // config 可选(旧版只传 playerCount)。playerCount 可选(新版只传 config)
      return d['config'] === undefined || typeof d['config'] === 'object';
    case 'update_room_config':
      return typeof d['config'] === 'object' && d['config'] !== null;
    default:
      return false;
  }
}

function isValidEngineClientMessage(data: unknown): data is EngineClientMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d['skillId'] === 'string' &&
    typeof d['actionType'] === 'string' &&
    typeof d['ownerId'] === 'number' &&
    typeof d['params'] === 'object' &&
    d['params'] !== null &&
    typeof d['baseSeq'] === 'number'
  );
}

export function serialize(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function deserialize(data: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return isValidClientMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
