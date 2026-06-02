// server/room.ts
import type { WSContext } from 'hono/ws';
import type { RoomInfo } from './protocol';
import { createRng } from '../shared/rng';

export interface Room {
  id: string;
  name: string;
  players: Map<string, WSContext>;
  maxPlayers: number;
  status: '等待中' | '进行中' | '已结束';
  /** 房主；调试房间无房主 */
  hostId: string | null;
  readyPlayers: Set<string>;
  isDebug?: boolean;
}

const roomList = new Map<string, Room>();

const roomIdRng = createRng(Date.now());

function generateRoomId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(roomIdRng.nextInt(chars.length));
  }
  return result;
}

function clampPlayers(n: number): number {
  return Math.min(Math.max(n, 2), 8);
}

/** 创建普通房间：需要 host 玩家立刻加入。 */
export function createRoom(name: string, maxPlayers: number, hostId: string, ws: WSContext): Room {
  const id = generateRoomId();
  const room: Room = {
    id,
    name,
    players: new Map([[hostId, ws]]),
    maxPlayers: clampPlayers(maxPlayers),
    status: '等待中',
    hostId,
    readyPlayers: new Set(),
  };
  roomList.set(id, room);
  return room;
}

/** 创建调试房间：无人加入、无 host。后续由 host 玩家调用 joinDebugRoom 进入。 */
export function createDebugRoom(name: string, maxPlayers: number): Room {
  const id = generateRoomId();
  const room: Room = {
    id,
    name,
    players: new Map(),
    maxPlayers: clampPlayers(maxPlayers),
    status: '等待中',
    hostId: null,
    readyPlayers: new Set(),
    isDebug: true,
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

export function addRoom(room: Room): void {
  roomList.set(room.id, room);
}

/** 调试玩家加入调试房间。 */
export function joinDebugRoom(roomId: string, playerId: string, ws: WSContext): Room | null {
  const room = roomList.get(roomId);
  if (!room?.isDebug) return null;
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

  if (room.hostId === playerId) {
    const newHost = room.players.keys().next().value;
    room.hostId = newHost ?? null;
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
      } catch (err) {
        // 单点失败不影响其他玩家
        console.warn(`[room ${room.id}] ws.send failed for player ${id}: ${String(err)}`);
      }
    }
  }
}
