// server/协议.ts
import type { PublicGameState, TurnPhase, PlayerAction, Role } from '../shared/types';

// 服务端 → 客户端
export type ServerMessage =
  | { type: 'state_update'; state: PublicGameState }
  | { type: 'your_turn'; phase: TurnPhase }
  | { type: 'prompt'; promptId: string; prompt: { name: string; 描述: string; 类型: string; 选项: unknown[] } }
  | { type: 'game_over'; winner: Role }
  | { type: 'error'; message: string }
  | { type: 'room_joined'; roomId: string; playerId: string }
  | { type: 'player_joined'; playerId: string }
  | { type: 'player_left'; playerId: string }
  | { type: 'game_started' }
  | { type: 'room_list'; rooms: RoomInfo[] };

// 客户端 → 服务端
export type ClientMessage =
  | { type: 'action'; action: PlayerAction }
  | { type: 'response'; promptId: string; choice: unknown }
  | { type: 'ready' }
  | { type: 'join_room'; roomId: string }
  | { type: 'create_room'; name: string; maxPlayers: number }
  | { type: 'start_game' }
  | { type: 'leave_room' }
  | { type: 'list_rooms' };

// 房间信息（用于列表展示）
export interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  status: '等待中' | '进行中' | '已结束';
}

// 验证消息格式
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
    case 'create_room':
      return typeof msg.name === 'string' && typeof msg.maxPlayers === 'number';
    default:
      return false;
  }
}

// 序列化消息
export function serialize(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

// 反序列化消息
export function deserialize(data: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (isValidClientMessage(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}
