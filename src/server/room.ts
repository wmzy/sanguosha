// server/room.ts
import type { WSContext } from 'hono/ws';
import type { RoomInfo, RoomConfig } from './protocol';
import { DEFAULT_ROOM_CONFIG, normalizeRoomConfig } from './protocol';
import { createRng } from '../shared/rng';
import { register } from './lifecycles';
import { createLogger } from './logger';

const log = createLogger('room');

export interface Room {
  id: string;
  name: string;
  players: Map<string, WSContext>;
  maxPlayers: number;
  status: '等待中' | '进行中' | '已结束';
  /** 房主;调试房间无房主(null) */
  hostId: string | null;
  readyPlayers: Set<string>;
  isDebug?: boolean;
  /** 房间级游戏配置 */
  config: RoomConfig;
}

const roomList = new Map<string, Room>();

const roomIdRng = createRng(Date.now());

register('roomList', roomList, () => {
  roomList.clear();
});

register('roomIdRng', roomIdRng, () => {});

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

/** 创建普通房间:需要 host 玩家立刻加入。 */
export function createRoom(name: string, maxPlayers: number, hostId: string, ws: WSContext, config?: RoomConfig): Room {
  const id = generateRoomId();
  const room: Room = {
    id,
    name,
    players: new Map([[hostId, ws]]),
    maxPlayers: clampPlayers(maxPlayers),
    status: '等待中',
    hostId,
    readyPlayers: new Set(),
    config: config ?? { ...DEFAULT_ROOM_CONFIG, name },
  };
  roomList.set(id, room);
  return room;
}

/** 创建调试房间:无人加入、无 host。后续由玩家调用 joinDebugRoom 进入。
 *  不立即开局——进入「配置+准备」阶段,所有座次就绪后由 start_game 触发。 */
export function createDebugRoom(name: string, maxPlayers: number, config?: RoomConfig): Room {
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
    config: config ?? { ...DEFAULT_ROOM_CONFIG, name },
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
export interface JoinDebugResult {
  room: Room;
  /** 被替换下线的旧 playerId（刷新重连时复用座次） */
  replacedPlayerId?: string;
}

/** 调试玩家加入调试房间。
 *  Debug 模式为“一人多连接”:一个浏览器开 N 个 WS 连接,每个代表一个座次。
 *  刷新页面时旧 WS 的 TCP close 有延迟,新连接到达时房间可能已满。
 *  此时踢掉最早加入的连接(插入序 FIFO),让新连接复用其座次 ——
 *  符合“刷新后重新接管所有座次”的语义。 */
export function joinDebugRoom(roomId: string, playerId: string, ws: WSContext): JoinDebugResult | null {
  const room = roomList.get(roomId);
  if (!room?.isDebug) return null;
  if (room.players.has(playerId)) return null;

  let replacedPlayerId: string | undefined;
  if (room.players.size >= room.maxPlayers) {
    // 踢掉最早加入的连接,复用其座次
    replacedPlayerId = room.players.keys().next().value;
    if (replacedPlayerId === undefined) return null;
    const oldWs = room.players.get(replacedPlayerId);
    room.players.delete(replacedPlayerId);
    try { oldWs?.close(); } catch { /* */ }
  }

  room.players.set(playerId, ws);
  return { room, replacedPlayerId };
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

/** 更新房间配置。仅房主可调用(调试房间无房主时任意座次可调用)。返回更新后的配置。 */
export function updateConfig(roomId: string, config: unknown, playerId: string): RoomConfig | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  if (room.status !== '等待中') return null;
  // 房主校验:调试房间无房主时允许任意玩家;否则仅房主
  if (room.hostId !== null && room.hostId !== playerId) return null;
  const normalized = normalizeRoomConfig(config);
  room.config = normalized;
  room.name = normalized.name;
  return normalized;
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

export function deleteRoom(roomId: string): boolean {
  return roomList.delete(roomId);
}

export function getRoomList(type?: 'debug' | 'multiplayer'): RoomInfo[] {
  const result: RoomInfo[] = [];
  for (const room of roomList.values()) {
    if (type === 'debug' && !room.isDebug) continue;
    if (type === 'multiplayer' && room.isDebug) continue;
    // 过滤掉没有活跃 session 的房间(无法加入)
    if (!hasSession(room.id)) continue;
    result.push({
      id: room.id,
      name: room.name,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      status: room.status,
      isDebug: room.isDebug === true,
      config: room.config,
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
        // 单点失败不影响其他玩家,但必须记录完整堆栈
        const e = err instanceof Error ? err : new Error(String(err));
        log.error(`ws.send failed for player ${id}`, { error: e.stack ?? String(e) });
      }
    }
  }
}

// session 活跃检查器:由 app.ts 注册(避免 room.ts 直接依赖 app.ts 的 gameSessions)。
let sessionChecker: ((roomId: string) => boolean) | null = null;
export function setSessionChecker(fn: (roomId: string) => boolean): void {
  sessionChecker = fn;
}
function hasSession(roomId: string): boolean {
  return sessionChecker ? sessionChecker(roomId) : true;
}
