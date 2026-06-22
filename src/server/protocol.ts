// src/server/protocol.ts
// 服务端协议层 — 按 ENGINE-DESIGN §8.2 事件流分叉广播。
// 服务端按 viewer 对事件流做 per-player 分叉,推送该 viewer 可见的 ViewEvent[]。
// 断线重连:拉 initialView baseline + 续推 lastSeq 之后的 events。
import type { ClientMessage as EngineClientMessage, GameView, Json, ViewEvent } from '../engine/types';
import type { Operation } from '../shared/log';

export type EventSeq = number;

/**
 * 服务端发往客户端的消息。
 * - initialView: 全量 baseline(首次/重连),viewer 隔离的 GameView。
 *   debug 多 WS 模型下,每个座次是独立连接,各自收自己 viewer 的 initialView。
 * - events: 增量事件流(§8.2.2),per-viewer 分叉后的 ViewEvent[],
 *   客户端走 viewReducer 增量更新 + playEffect 播放动画。
 * 两种消息都携带 viewer 字段,标识归属哪个座次视角。
 */
export type ServerMessage =
  | { type: 'initialView'; viewer: number; state: GameView; lastSeq: EventSeq }
  | { type: 'events'; viewer: number; fromSeq: EventSeq; events: GameEventEnvelope[]; operations?: Operation[] }
  | { type: 'error'; message: string }
  | { type: 'gameOver'; winner: string }
  | { type: 'room_joined'; roomId: string; playerId: string; seatIndex?: number }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
  | { type: 'player_disconnected'; playerId: string; graceMs: number }
  | { type: 'player_reconnected'; playerId: string }
  | { type: 'game_started' }
  | { type: 'room_list'; rooms: RoomInfo[] };

/**
 * 推送给客户端的事件 envelope(per-viewer 已分叉)。
 * session 从 ViewEventSplit 按 viewer 可见性投影后,填入 viewEvent(或 notify)。
 * - viewEvent: atom 转换后的前端视图事件(含 effect),前端走 viewReducer + playEffect。
 * - notify: 技能通知事件(按 views 分叉后),前端按 skillId+eventType 订阅。
 */
export interface GameEventEnvelope {
  seq: EventSeq;
  /** 事件 timestamp,相对 game startedAt */
  timestamp: number;
  /** atom 事件(per-viewer 分叉后的视图事件,含 effect) */
  viewEvent?: ViewEvent;
  /** 通知事件(per-viewer 分叉后的 data) */
  notify?: { skillId: string; eventType: string; data: Json };
}

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
  | { type: 'create_debug_room'; playerCount: number }
  | { type: 'join_debug_room'; roomId: string; lastSeq?: EventSeq }
  | { type: 'delete_room' }
  | { type: 'start_game' }
  | { type: 'leave_room' }
  | { type: 'list_rooms'; filter?: 'debug' | 'multiplayer' }
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
    case 'delete_room':
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
    case 'create_debug_room':
      return typeof d['playerCount'] === 'number';
    case 'list_rooms':
      return d['filter'] === undefined || d['filter'] === 'debug' || d['filter'] === 'multiplayer';
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
