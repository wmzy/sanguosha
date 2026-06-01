import type { GameAction, GameState, GameView } from '../engine/v2/types';

export interface PlayerEvent {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
}

export type ServerMessage =
  | { type: 'gameView'; view: GameView }
  | { type: 'debugGameState'; state: GameState }
  | { type: 'events'; events: PlayerEvent[] }
  | { type: 'error'; message: string }
  | { type: 'gameOver'; winner: string }
  | { type: 'room_joined'; roomId: string; playerId: string }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
  | { type: 'game_started' }
  | { type: 'room_list'; rooms: RoomInfo[] };

export type ClientMessage =
  | { type: 'action'; action: GameAction }
  | { type: 'response'; promptId: string; choice: unknown }
  | { type: 'ready' }
  | { type: 'join_room'; roomId: string }
  | { type: 'create_room'; name: string; maxPlayers: number }
  | { type: 'create_debug_room'; playerCount: number }
  | { type: 'delete_room' }
  | { type: 'start_game' }
  | { type: 'leave_room' }
  | { type: 'list_rooms' }
  | { type: 'reconnect'; playerId: string };

export interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  status: '等待中' | '进行中' | '已结束';
}

export function isValidClientMessage(data: unknown): data is ClientMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  if (typeof msg.type !== 'string') return false;

  switch (msg.type) {
    case 'action':
      return typeof msg.action === 'object' && msg.action !== null;
    case 'response':
      return typeof msg.promptId === 'string';
    case 'ready':
    case 'list_rooms':
    case 'start_game':
    case 'leave_room':
      return true;
    case 'join_room':
      return typeof msg.roomId === 'string';
    case 'reconnect':
      return typeof msg.playerId === 'string';
    case 'create_room':
      return typeof msg.name === 'string' && typeof msg.maxPlayers === 'number';
    case 'create_debug_room':
      return typeof msg.playerCount === 'number' && msg.playerCount >= 2 && msg.playerCount <= 8;
    case 'delete_room':
      return true;
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
