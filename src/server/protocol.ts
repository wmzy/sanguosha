// src/server/protocol.ts
// 服务端协议层 — 事件流广播。
// 每次 atom apply 后,服务端逐条发送 event 消息给该 viewer 可见的事件。
// 断线重连:拉 initialView baseline(全量 GameView),之后继续推 event。
// viewer 由 WS 连接标识,不需要在消息中携带。
import type { ClientMessage as EngineClientMessage, GameView, Json, ViewEvent } from '../engine/types';
export type { GameEventEnvelope } from '../engine/types';

export type EventSeq = number;

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
 * - event: 单个视图事件。每次 atom apply 后逐条发送。
 *   viewer 由 WS 连接标识,不在消息中携带。
 *   effect 不下发,前端通过 AtomDefinition.effect 静态查表。
 *   deadline 仅在变化时附加(合并了 pending deadline 和 turn idle deadline)。
 */
export type ServerMessage =
  | { type: 'initialView'; state: GameView; lastSeq: EventSeq }
  | { type: 'event'; seq: EventSeq; timestamp: number; view: ViewEvent;
      deadline?: DeadlineInfo | null }
  | { type: 'error'; message: string }
  | { type: 'actionRejected' }
  | { type: 'gameOver'; winner: string }
  | { type: 'room_joined'; roomId: string; playerId: string; seatIndex?: number }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
  | { type: 'player_disconnected'; playerId: string; graceMs: number }
  | { type: 'player_reconnected'; playerId: string }
  | { type: 'game_started' };

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
  | { type: 'create_room'; name: string; maxPlayers: number }
  | { type: 'join_debug_room'; roomId: string; lastSeq?: EventSeq }
  | { type: 'start_game' }
  | { type: 'leave_room' }
  | { type: 'reconnect'; playerId: string; lastSeq?: EventSeq };

export interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  status: string;
  isDebug?: boolean;
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
    case 'leave_room':
      return true;
    case 'join_room':
    case 'join_debug_room':
      return typeof d['roomId'] === 'string';
    case 'reconnect':
      return typeof d['playerId'] === 'string';
    case 'create_room':
      return typeof d['name'] === 'string' && typeof d['maxPlayers'] === 'number';
    default:
      return false;
  }
}

function isValidEngineClientMessage(data: unknown): data is EngineClientMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d['skillId'] === 'string'
    && typeof d['actionType'] === 'string'
    && typeof d['ownerId'] === 'number'
    && typeof d['params'] === 'object' && d['params'] !== null
    && typeof d['baseSeq'] === 'number';
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
