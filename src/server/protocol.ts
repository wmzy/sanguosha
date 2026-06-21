// src/server/protocol.ts
// 服务端协议层 — 切到新 ENGINE-DESIGN ClientMessage + GameView
// 新 ENGINE-DESIGN 没有独立的事件流序号(SequencedEvent 取消),
// 客户端轮询/订阅 state.seq 即可,断线重连直接拉最新 GameView。
import type { ClientMessage as EngineClientMessage, GameView, Json } from '../engine/types';
import type { Operation } from '../shared/log';

export type EventSeq = number;

/**
 * 服务端发往客户端的消息。
 * initialView / debugGameState 用新 ENGINE-DESIGN 的 GameView(viewer 隔离)。
 */
export type ServerMessage =
  | { type: 'initialView'; state: GameView; lastSeq: EventSeq }
  | { type: 'debugGameState'; state: GameView; lastSeq: EventSeq }
  | { type: 'events'; fromSeq: EventSeq; events: GameEventEnvelope[]; operations?: Operation[] }
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
 * 推送给客户端的事件 envelope(per-player 视图)。
 * 新 ENGINE-DESIGN 的事件流由 atom + notify 组成(见 types.ts GameEvent)。
 */
export interface GameEventEnvelope {
  seq: EventSeq;
  /** 事件 timestamp,相对 game startedAt */
  timestamp: number;
  /** atom 事件 */
  atom?: import('../engine/types').Atom;
  /** 通知事件 */
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
