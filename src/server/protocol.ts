import type { ClientMessage as EngineClientMessage, GameState } from '../engine/types';
import type { GameView } from '../engine/types';
import type { Operation } from '../shared/log';

/**
 * 事件协议层序号：服务端 GameSession 维护的全局递增序号。
 * 客户端用它做去重 + 断点续传（reconnect 时携带 lastAppliedSeq，
 * 服务端从 lastAppliedSeq+1 开始回放）。
 */
export type EventSeq = number;

/**
 * 一条广播事件的传输形态：基于 AtomLogEntry 展平为 {id, type, timestamp, payload}，
 * 附加 seq 协议层序号。type 从 entry.atom.type 提取，payload 直接持 atom 本身，
 * 客户端拿到即可走 reducer（与原 ServerEvent 形态保持兼容）。
 */
export interface SequencedEvent {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
  seq: EventSeq;
}

export type ServerMessage =
  | { type: 'initialView'; state: GameView; lastSeq: EventSeq }
  | { type: 'debugGameState'; state: GameState; lastSeq: EventSeq }
  | { type: 'events'; fromSeq: EventSeq; events: SequencedEvent[]; operations?: Operation[] }
  | { type: 'error'; message: string }
  | { type: 'gameOver'; winner: string }
  | { type: 'room_joined'; roomId: string; playerId: string }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
  | { type: 'player_disconnected'; playerId: string; graceMs: number }
  | { type: 'player_reconnected'; playerId: string }
  | { type: 'game_started' }
  | { type: 'room_list'; rooms: RoomInfo[] }
  | { type: 'asyncHookPending'; pendingId: string; hookId: string; player: string; def: unknown; timeout: number; deadline: number };

// Re-export for downstream consumers
export type { GameView };

export type ClientMessage =
  | { type: 'action'; action: EngineClientMessage; baseSeq: EventSeq }
  | { type: 'response'; baseSeq: EventSeq; choice: unknown }
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
  status: '等待中' | '进行中' | '已结束';
  isDebug: boolean;
}

export function isValidClientMessage(data: unknown): data is ClientMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  switch (msg.type) {
    case 'action':
      return typeof msg.action === 'object' && msg.action !== null && typeof msg.baseSeq === 'number';
    case 'response':
      return typeof msg.baseSeq === 'number';
    case 'ready':
    case 'start_game':
    case 'leave_room':
    case 'delete_room':
      return true;
    case 'list_rooms':
      return msg.filter === undefined || msg.filter === 'debug' || msg.filter === 'multiplayer';
    case 'join_room':
      return typeof msg.roomId === 'string';
    case 'reconnect':
      return typeof msg.playerId === 'string' && (msg.lastSeq === undefined || typeof msg.lastSeq === 'number');
    case 'create_room':
      return typeof msg.name === 'string' && typeof msg.maxPlayers === 'number';
    case 'create_debug_room':
      return typeof msg.playerCount === 'number' && msg.playerCount >= 2 && msg.playerCount <= 8;
    case 'join_debug_room':
      return typeof msg.roomId === 'string' && (msg.lastSeq === undefined || typeof msg.lastSeq === 'number');
    default:
      return false;
  }
}

export function serialize(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function deserialize(data: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (isValidClientMessage(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}
