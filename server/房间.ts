// server/房间.ts
import type { WSContext } from 'hono/ws';
import type { RoomInfo } from './协议';

export interface Room {
  id: string;
  name: string;
  players: Map<string, WSContext>;
  maxPlayers: number;
  status: '等待中' | '进行中' | '已结束';
  hostId: string;
  readyPlayers: Set<string>;
}

const 房间列表 = new Map<string, Room>();

function 生成房间号(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function 创建房间(name: string, maxPlayers: number, hostId: string, ws: WSContext): Room {
  const id = 生成房间号();
  const room: Room = {
    id,
    name,
    players: new Map([[hostId, ws]]),
    maxPlayers: Math.min(Math.max(maxPlayers, 2), 8),
    status: '等待中',
    hostId,
    readyPlayers: new Set(),
  };
  房间列表.set(id, room);
  return room;
}

export function 加入房间(roomId: string, playerId: string, ws: WSContext): Room | null {
  const room = 房间列表.get(roomId);
  if (!room) return null;
  if (room.status !== '等待中') return null;
  if (room.players.size >= room.maxPlayers) return null;
  if (room.players.has(playerId)) return null;

  room.players.set(playerId, ws);
  return room;
}

export function 离开房间(roomId: string, playerId: string): Room | null {
  const room = 房间列表.get(roomId);
  if (!room) return null;

  room.players.delete(playerId);
  room.readyPlayers.delete(playerId);

  if (room.players.size === 0) {
    房间列表.delete(roomId);
    return null;
  }

  // 如果房主离开，转移房主
  if (room.hostId === playerId) {
    const newHost = room.players.keys().next().value;
    if (newHost) room.hostId = newHost;
  }

  return room;
}

export function 设置准备(roomId: string, playerId: string): boolean {
  const room = 房间列表.get(roomId);
  if (!room || room.status !== '等待中') return false;

  room.readyPlayers.add(playerId);
  return true;
}

export function 所有人准备(roomId: string): boolean {
  const room = 房间列表.get(roomId);
  if (!room) return false;
  if (room.players.size < 2) return false;
  return room.readyPlayers.size === room.players.size;
}

export function 设置房间状态(roomId: string, status: Room['status']): void {
  const room = 房间列表.get(roomId);
  if (room) room.status = status;
}

export function 获取房间(roomId: string): Room | null {
  return 房间列表.get(roomId) ?? null;
}

export function 获取房间列表(): RoomInfo[] {
  const result: RoomInfo[] = [];
  for (const room of 房间列表.values()) {
    result.push({
      id: room.id,
      name: room.name,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      status: room.status,
    });
  }
  return result;
}

export function 根据玩家ID查找房间(playerId: string): Room | null {
  for (const room of 房间列表.values()) {
    if (room.players.has(playerId)) return room;
  }
  return null;
}

export function 广播消息(room: Room, message: string, excludeId?: string): void {
  for (const [id, ws] of room.players) {
    if (id !== excludeId) {
      try {
        ws.send(message);
      } catch {
        // 忽略发送失败
      }
    }
  }
}
