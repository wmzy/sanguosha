// server/room.ts
import type { WSContext } from 'hono/ws';
import type { RoomInfo } from './protocol';

export interface Room {
  id: string;
  name: string;
  players: Map<string, WSContext>;
  maxPlayers: number;
  status: '等待中' | '进行中' | '已结束';
  hostId: string;
  readyPlayers: Set<string>;
}

const roomList = new Map<string, Room>();

function generateRoomId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function createRoom(name: string, maxPlayers: number, hostId: string, ws: WSContext): Room {
  const id = generateRoomId();
  const room: Room = {
    id,
    name,
    players: new Map([[hostId, ws]]),
    maxPlayers: Math.min(Math.max(maxPlayers, 2), 8),
    status: '等待中',
    hostId,
    readyPlayers: new Set(),
  };
  roomList.set(id, room);
  return room;
}

export function joinRoom(roomId: string, playerId: string, ws: WSContext): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  if (room.status !== '等待中') return null;
  if (room.players.size >= room.maxPlayers) return null;
  if (room.players.has(playerId)) return null;

  room.players.set(playerId, ws);
  return room;
}

export function leaveRoom(roomId: string, playerId: string): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;

  room.players.delete(playerId);
  room.readyPlayers.delete(playerId);

  if (room.players.size === 0) {
    roomList.delete(roomId);
    return null;
  }

  // 如果房主离开，转移房主
  if (room.hostId === playerId) {
    const newHost = room.players.keys().next().value;
    if (newHost) room.hostId = newHost;
  }

  return room;
}

export function setReady(roomId: string, playerId: string): boolean {
  const room = roomList.get(roomId);
  if (room?.status !== '等待中') return false;

  room.readyPlayers.add(playerId);
  return true;
}

export function allReady(roomId: string): boolean {
  const room = roomList.get(roomId);
  if (!room) return false;
  if (room.players.size < 2) return false;
  return room.readyPlayers.size === room.players.size;
}

export function setRoomStatus(roomId: string, status: Room['status']): void {
  const room = roomList.get(roomId);
  if (room) room.status = status;
}

export function getRoom(roomId: string): Room | null {
  return roomList.get(roomId) ?? null;
}

export function getRoomList(): RoomInfo[] {
  const result: RoomInfo[] = [];
  for (const room of roomList.values()) {
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

export function findRoomByPlayerId(playerId: string): Room | null {
  for (const room of roomList.values()) {
    if (room.players.has(playerId)) return room;
  }
  return null;
}

export function broadcastMessage(room: Room, message: string, excludeId?: string): void {
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
