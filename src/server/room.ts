// server/room.ts
import type { ConnectionSink } from './connection';
import type { RoomInfo, RoomConfig, ServerMessage } from './protocol';
import { DEFAULT_ROOM_CONFIG, normalizeRoomConfig } from './protocol';
import { createRng } from '../shared/rng';
import { register } from './lifecycles';
import { createLogger } from './logger';

const log = createLogger('room');

export interface Room {
  id: string;
  name: string;
  players: Map<string, ConnectionSink>;
  maxPlayers: number;
  status: '等待中' | '进行中' | '已结束';
  /** 房主;调试房间无房主(null) */
  hostId: string | null;
  readyPlayers: Set<string>;
  /** 房间类型: normal=持久化,不自动销毁不自动换主; quick=纯内存 */
  roomType: 'normal' | 'quick';
  isDebug?: boolean;
  /** 房间级游戏配置 */
  config: RoomConfig;
  /** 旁观者连接（不占 maxPlayers 名额）。spectatorId → sink */
  spectators: Map<string, ConnectionSink>;
  /** 视图授权：spectatorId → 被授权查看的玩家座次下标 */
  viewGrants: Map<string, number>;
  /** 待处理申请：spectatorId → 申请查看的座次下标 */
  pendingViewRequests: Map<string, number>;
  /** 聊天用量跟踪：playerId → { total: number; timestamps: number[] } */
  chatUsage: Map<string, { total: number; timestamps: number[] }>;
  /** 聊天历史（最近 50 条，供重连获取） */
  chatHistory: Array<{ playerId: string; seatIndex: number; text: string; timestamp: number }>;
  /** 座位表：seats[i] = 座次 i 的 playerId，null=空座。长度始终 = maxPlayers */
  seats: (string | null)[];
  /** 待处理座位交换请求：requesterId → { targetSeat, expiresAt, timer } */
  pendingSeatSwaps: Map<string, { targetSeat: number; expiresAt: number; timer: ReturnType<typeof setTimeout> }>;
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

/** 座位交换请求超时(ms) */
export const SEAT_SWAP_TIMEOUT_MS = 15_000;

/** 构造 room_state ServerMessage（集中一处，避免 rest.ts/sse.ts 重复构造）。 */
export function buildRoomState(room: Room): ServerMessage {
  return {
    type: 'room_state',
    readyPlayers: [...room.readyPlayers],
    playerIds: room.seats.filter((s): s is string => s !== null),
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    config: room.config,
    spectatorIds: [...room.spectators.keys()],
    viewGrants: Object.fromEntries(room.viewGrants),
    pendingViewRequests: Object.fromEntries(room.pendingViewRequests),
    roomType: room.roomType,
    seats: [...room.seats],
    pendingSeatSwaps: Object.fromEntries(
      [...room.pendingSeatSwaps.entries()].map(([id, v]) => [
        id,
        { targetSeat: v.targetSeat, expiresAt: v.expiresAt },
      ]),
    ),
  };
}

/** 获取玩家当前座次下标（-1=不在座位表中）。 */
export function getPlayerSeat(room: Room, playerId: string): number {
  return room.seats.indexOf(playerId);
}

/** 创建普通房间:需要 host 玩家立刻加入。
 *  roomType: 'normal'=持久化到 DB, 不自动销毁不自动换主; 'quick'=纯内存(默认)。 */
export function createRoom(
  name: string,
  maxPlayers: number,
  hostId: string,
  sink: ConnectionSink,
  config?: RoomConfig,
  roomType: 'normal' | 'quick' = 'quick',
): Room {
  const id = generateRoomId();
  const seats: (string | null)[] = Array(clampPlayers(maxPlayers)).fill(null);
  seats[0] = hostId;
  const room: Room = {
    id,
    name,
    players: new Map([[hostId, sink]]),
    maxPlayers: clampPlayers(maxPlayers),
    status: '等待中',
    hostId,
    readyPlayers: new Set(),
    roomType,
    config: config ?? { ...DEFAULT_ROOM_CONFIG, name },
    spectators: new Map(),
    viewGrants: new Map(),
    pendingViewRequests: new Map(),
    chatUsage: new Map(),
    chatHistory: [],
    seats,
    pendingSeatSwaps: new Map(),
  };
  roomList.set(id, room);
  roomChangeHandler?.(room, 'create');
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
    roomType: 'quick',
    isDebug: true,
    config: config ?? { ...DEFAULT_ROOM_CONFIG, name },
    spectators: new Map(),
    viewGrants: new Map(),
    pendingViewRequests: new Map(),
    chatUsage: new Map(),
    chatHistory: [],
    seats: Array(clampPlayers(maxPlayers)).fill(null),
    pendingSeatSwaps: new Map(),
  };
  roomList.set(id, room);
  return room;
}

export function joinRoom(roomId: string, playerId: string, sink: ConnectionSink): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  if (room.status !== '等待中') return null;
  if (room.players.has(playerId)) return null;

  // 如果玩家已在 seats 中（SSE 断开重连时 seats 残留），复用已有座位
  const existingSeat = room.seats.indexOf(playerId);
  if (existingSeat >= 0) {
    room.players.set(playerId, sink);
    return room;
  }

  // 新玩家加入：检查人数上限
  if (room.players.size >= room.maxPlayers) return null;

  room.players.set(playerId, sink);
  // 分配首个空座位
  const emptySeat = room.seats.indexOf(null);
  if (emptySeat >= 0) {
    room.seats[emptySeat] = playerId;
  } else {
    // seats 已满但 players 未满（异常状态）: 追加座位
    room.seats.push(playerId);
  }
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
export function joinDebugRoom(
  roomId: string,
  playerId: string,
  sink: ConnectionSink,
): JoinDebugResult | null {
  const room = roomList.get(roomId);
  if (!room?.isDebug) return null;
  if (room.players.has(playerId)) return null;

  let replacedPlayerId: string | undefined;
  if (room.players.size >= room.maxPlayers) {
    // 踢掉最早加入的连接,复用其座次
    replacedPlayerId = room.players.keys().next().value;
    if (replacedPlayerId === undefined) return null;
    const oldSink = room.players.get(replacedPlayerId);
    room.players.delete(replacedPlayerId);
    // 清理被踢玩家的座位
    const replacedSeat = room.seats.indexOf(replacedPlayerId);
    if (replacedSeat >= 0) room.seats[replacedSeat] = null;
    try {
      oldSink?.close();
    } catch {
      /* */
    }
  }

  room.players.set(playerId, sink);
  // 复用已有座位或分配首个空座位（防止重复入座）
  const existingDebugSeat = room.seats.indexOf(playerId);
  if (existingDebugSeat >= 0) {
    return { room, replacedPlayerId };
  }
  // 分配首个空座位
  const emptySeat = room.seats.indexOf(null);
  if (emptySeat >= 0) {
    room.seats[emptySeat] = playerId;
  } else {
    room.seats.push(playerId);
  }
  return { room, replacedPlayerId };
}

export function leaveRoom(roomId: string, playerId: string): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;

  room.players.delete(playerId);
  room.readyPlayers.delete(playerId);
  // 清除座位 + 取消该玩家的交换请求
  const seatIdx = room.seats.indexOf(playerId);
  if (seatIdx >= 0) room.seats[seatIdx] = null;
  const pendingSwap = room.pendingSeatSwaps.get(playerId);
  if (pendingSwap) {
    clearTimeout(pendingSwap.timer);
    room.pendingSeatSwaps.delete(playerId);
  }
  // 如果有人请求与离开的玩家交换,也取消
  for (const [reqId, swap] of room.pendingSeatSwaps) {
    if (room.seats[swap.targetSeat] === null) {
      clearTimeout(swap.timer);
      room.pendingSeatSwaps.delete(reqId);
    }
  }

  // 普通房间: 不自动销毁, 不自动换主。仅同步 DB。
  if (room.roomType === 'normal') {
    roomChangeHandler?.(room, 'update');
    return room;
  }

  // 快速房间: 无进行中游戏且全员离开 → 自动销毁(统一走 deleteRoom)
  if (room.players.size === 0 && room.status !== '进行中') {
    deleteRoom(roomId);
    return null;
  }

  // 快速房间: 房主离开 → 自动选新房主
  if (room.hostId === playerId) {
    const newHost = room.players.keys().next().value;
    room.hostId = newHost ?? null;
  }

  return room;
}

/** 更新房间配置。仅房主可调用(调试房间无房主时任意座次可调用)。
 *  可选 maxPlayers: 修改房间最大人数(须 >= 当前在线人数, 2-8)。
 *  配置变更后重置所有玩家的准备状态。返回更新后的配置。 */
export function updateConfig(roomId: string, config: unknown, playerId: string, maxPlayers?: number): RoomConfig | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  if (room.status !== '等待中') return null;
  // 房主校验:调试房间无房主时允许任意玩家;否则仅房主
  if (room.hostId !== null && room.hostId !== playerId) return null;
  const normalized = normalizeRoomConfig(config);
  room.config = normalized;
  room.name = normalized.name;
  // 更新最大人数:不得少于当前在线人数
  if (maxPlayers !== undefined) {
    const clamped = clampPlayers(maxPlayers);
    if (clamped < room.players.size) return null;
    // 调整 seats 数组大小
    if (clamped > room.seats.length) {
      // 扩展:追加空座位
      room.seats.push(...Array(clamped - room.seats.length).fill(null));
    } else if (clamped < room.seats.length) {
      // 收缩:尾部空座位可安全移除(被占用则拒绝)
      for (let i = clamped; i < room.seats.length; i++) {
        if (room.seats[i] !== null) return null;
      }
      room.seats.length = clamped;
    }
    room.maxPlayers = clamped;
  }
  // 配置变更 → 重置准备状态
  room.readyPlayers.clear();
  roomChangeHandler?.(room, 'update');
  return normalized;
}

export function setReady(roomId: string, playerId: string): boolean {
  const room = roomList.get(roomId);
  if (room?.status !== '等待中') return false;

  room.readyPlayers.add(playerId);
  return true;
}

export function unsetReady(roomId: string, playerId: string): boolean {
  const room = roomList.get(roomId);
  if (room?.status !== '等待中') return false;

  return room.readyPlayers.delete(playerId);
}

export function allReady(roomId: string): boolean {
  const room = roomList.get(roomId);
  if (!room) return false;
  if (room.players.size < 2) return false;
  return room.readyPlayers.size === room.players.size;
}

export function setRoomStatus(roomId: string, status: Room['status']): void {
  const room = roomList.get(roomId);
  if (room) {
    room.status = status;
    roomChangeHandler?.(room, 'update');
  }
}

export function getRoom(roomId: string): Room | null {
  return roomList.get(roomId) ?? null;
}

export function deleteRoom(roomId: string): boolean {
  const room = roomList.get(roomId);
  if (!room) return false;
  roomList.delete(roomId);
  roomChangeHandler?.(room, 'delete');
  return true;
}

/** 返回所有房间原始对象(不过滤)。
 *  供启动恢复/清理逻辑使用:getRoomList 会过滤掉"进行中无 session"的房间,
 *  但 downgradeStaleNormalRooms 正需要降级这些被过滤的房间。 */
export function getAllRooms(): Room[] {
  return [...roomList.values()];
}

export function getRoomList(type?: 'debug' | 'multiplayer'): RoomInfo[] {
  const result: RoomInfo[] = [];
  for (const room of roomList.values()) {
    if (type === 'debug' && !room.isDebug) continue;
    if (type === 'multiplayer' && room.isDebug) continue;
    // 进行中/已结束的房间必须有活跃 session 才可见;
    // 等待中的房间(新建未开局)无需 session 即可被发现和加入。
    if (room.status !== '等待中' && !hasSession(room.id)) continue;
    // 死房间(仅快速房间): 进行中/已结束但座次全空且无在线玩家(重启后 seats 丢失的恢复房间)。
    // 无人可重连,不展示在列表中,避免用户看到无法进入的房间。
    // 普通房间不自动清理,必须保持可见以便房主管理。
    if (room.roomType !== 'normal' && room.status !== '等待中' && room.players.size === 0 && room.seats.every((s) => s === null)) continue;
    result.push({
      id: room.id,
      name: room.name,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      status: room.status,
      hostId: room.hostId,
      isDebug: room.isDebug === true,
      roomType: room.roomType,
      config: room.config,
      spectatorCount: room.spectators.size,
      // seats 在 SSE 断线后仍保留(仅 leaveRoom 清理),用于判断"玩家是否在房间中"
      playerIds: room.seats.filter((s): s is string => s !== null),
    });
  }
  return result;
}

export function findRoomByPlayerId(playerId: string): Room | null {
  for (const room of roomList.values()) {
    if (room.players.has(playerId) || room.spectators.has(playerId)) return room;
  }
  return null;
}

export function broadcastMessage(room: Room, message: ServerMessage, excludeId?: string): void {
  for (const [id, sink] of room.players) {
    if (id !== excludeId) {
      try {
        sink.send(message);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        log.error(`ws.send failed for player ${id}`, { error: e.stack ?? String(e) });
      }
    }
  }
  // 旁观者也接收广播消息（room_state/game_started/gameOver 等）
  for (const [id, sink] of room.spectators) {
    if (id !== excludeId) {
      try {
        sink.send(message);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        log.error(`ws.send failed for spectator ${id}`, { error: e.stack ?? String(e) });
      }
    }
  }
}

// session 活跃检查器:由 app.ts 注册(避免 room.ts 直接依赖 app.ts 的 gameSessions)。
let sessionChecker: ((roomId: string) => boolean) | null = null;
export function setSessionChecker(fn: ((roomId: string) => boolean) | null): void {
  sessionChecker = fn;
}
function hasSession(roomId: string): boolean {
  return sessionChecker ? sessionChecker(roomId) : true;
}

// 房间变更通知器:由 roomStore 注册,持久化普通房间元数据。
let roomChangeHandler: ((room: Room, action: 'create' | 'update' | 'delete') => void) | null = null;
export function setRoomChangeHandler(
  fn: ((room: Room, action: 'create' | 'update' | 'delete') => void) | null,
): void {
  roomChangeHandler = fn;
}

// ── 座位管理 ──

/** 清理玩家的待处理交换请求（内部）。 */
function cancelSeatSwapInternal(room: Room, requesterId: string): void {
  const pending = room.pendingSeatSwaps.get(requesterId);
  if (pending) {
    clearTimeout(pending.timer);
    room.pendingSeatSwaps.delete(requesterId);
  }
}

/** 移动到空座位。仅等待中允许。 */
export function moveSeat(roomId: string, playerId: string, targetSeat: number): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  if (room.status !== '等待中') return null;
  if (!room.players.has(playerId)) return null;
  if (targetSeat < 0 || targetSeat >= room.seats.length) return null;
  if (room.seats[targetSeat] !== null) return null; // 目标座位已有人

  const currentSeat = room.seats.indexOf(playerId);
  if (currentSeat === targetSeat) return room; // no-op
  if (currentSeat >= 0) room.seats[currentSeat] = null;
  room.seats[targetSeat] = playerId;
  // 移座后取消自己的交换请求
  cancelSeatSwapInternal(room, playerId);
  return room;
}

/** 请求座位交换。仅等待中、目标座位有人时允许。
 *  返回 { room, targetPlayerId } 供调用方广播 seat_swap_request。 */
export function requestSeatSwap(
  roomId: string,
  requesterId: string,
  targetSeat: number,
): { room: Room; targetPlayerId: string; requesterSeat: number; expiresAt: number } | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  if (room.status !== '等待中') return null;
  if (!room.players.has(requesterId)) return null;
  if (targetSeat < 0 || targetSeat >= room.seats.length) return null;

  const targetPlayerId = room.seats[targetSeat];
  if (!targetPlayerId || targetPlayerId === requesterId) return null;

  const requesterSeat = room.seats.indexOf(requesterId);
  if (requesterSeat < 0) return null;

  // 清理已有请求（同一玩家只能有一个待处理交换）
  cancelSeatSwapInternal(room, requesterId);

  const expiresAt = Date.now() + SEAT_SWAP_TIMEOUT_MS;
  const timer = setTimeout(() => {
    expireSeatSwap(roomId, requesterId);
  }, SEAT_SWAP_TIMEOUT_MS);

  room.pendingSeatSwaps.set(requesterId, { targetSeat, expiresAt, timer });
  return { room, targetPlayerId, requesterSeat, expiresAt };
}

/** 响应座位交换请求。responderId 是被请求方（目标座位当前玩家）。
 *  accept=true 时执行交换，返回 { room, swapped: true }。
 *  accept=false 时仅清理请求，返回 { room, swapped: false }。 */
export function respondSeatSwap(
  roomId: string,
  responderId: string,
  requesterId: string,
  accept: boolean,
): { room: Room; swapped: boolean } | null {
  const room = roomList.get(roomId);
  if (!room) return null;

  const pending = room.pendingSeatSwaps.get(requesterId);
  if (!pending) return null;

  // 验证 responder 是目标座位的当前玩家
  if (room.seats[pending.targetSeat] !== responderId) return null;

  clearTimeout(pending.timer);
  room.pendingSeatSwaps.delete(requesterId);

  if (accept) {
    const requesterSeat = room.seats.indexOf(requesterId);
    if (requesterSeat < 0) return null;
    // 交换座位
    room.seats[requesterSeat] = responderId;
    room.seats[pending.targetSeat] = requesterId;
    return { room, swapped: true };
  }

  return { room, swapped: false };
}

/** 超时自动拒绝交换请求（由 setTimeout 触发）。 */
function expireSeatSwap(roomId: string, requesterId: string): void {
  const room = roomList.get(roomId);
  if (!room) return;
  const pending = room.pendingSeatSwaps.get(requesterId);
  if (!pending) return;
  room.pendingSeatSwaps.delete(requesterId);
  const responderId = room.seats[pending.targetSeat] ?? '';
  broadcastMessage(room, { type: 'seat_swap_result', success: false, requesterId, responderId });
  broadcastMessage(room, buildRoomState(room));
}

// ── 旁观者管理 ──

/** 以旁观者身份加入房间。不占 maxPlayers 名额。 */
export function joinAsSpectator(roomId: string, spectatorId: string, sink: ConnectionSink): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  room.spectators.set(spectatorId, sink);
  return room;
}

/** 旁观者离开/断线：清理连接、授权和待处理申请。 */
export function removeSpectator(roomId: string, spectatorId: string): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  room.spectators.delete(spectatorId);
  room.viewGrants.delete(spectatorId);
  room.pendingViewRequests.delete(spectatorId);
  return room;
}

/** 切换玩家身份（仅等待中允许）。player↔spectator。 */
export function switchRole(
  roomId: string,
  playerId: string,
  newRole: 'player' | 'spectator',
): { room: Room; success: boolean } {
  const room = roomList.get(roomId);
  if (!room) return { room: null as never, success: false };
  if (room.status !== '等待中') return { room, success: false };

  if (newRole === 'spectator') {
    // player → spectator
    const sink = room.players.get(playerId);
    if (!sink) return { room, success: false };
    room.players.delete(playerId);
    room.readyPlayers.delete(playerId);
    // 清除座位
    const seatIdx = room.seats.indexOf(playerId);
    if (seatIdx >= 0) room.seats[seatIdx] = null;
    // 取消交换请求
    cancelSeatSwapInternal(room, playerId);
    room.spectators.set(playerId, sink);
    // 房主切旁观仍保留 hostId（管理权限不变）
    return { room, success: true };
  } else {
    // spectator → player
    const sink = room.spectators.get(playerId);
    if (!sink) return { room, success: false };
    if (room.players.size >= room.maxPlayers) return { room, success: false };
    room.spectators.delete(playerId);
    room.viewGrants.delete(playerId);
    room.pendingViewRequests.delete(playerId);
    room.players.set(playerId, sink);
    // 分配首个空座位
    const emptySeat = room.seats.indexOf(null);
    if (emptySeat >= 0) room.seats[emptySeat] = playerId;
    return { room, success: true };
  }
}

/** 旁观者申请查看指定座次的视图。 */
export function requestView(roomId: string, spectatorId: string, targetSeat: number): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  if (!room.spectators.has(spectatorId)) return null;
  room.pendingViewRequests.set(spectatorId, targetSeat);
  return room;
}

/** 玩家审批通过：设置 viewGrant。 */
export function approveView(roomId: string, spectatorId: string, targetSeat: number): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  room.viewGrants.set(spectatorId, targetSeat);
  room.pendingViewRequests.delete(spectatorId);
  return room;
}

/** 玩家拒绝申请。 */
export function rejectView(roomId: string, spectatorId: string): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  room.pendingViewRequests.delete(spectatorId);
  return room;
}

/** 玩家撤销已授权。 */
export function revokeView(roomId: string, spectatorId: string): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  room.viewGrants.delete(spectatorId);
  return room;
}

// ── 聊天管理 ──

/** 聊天验证结果。 */
export interface ChatValidation {
  ok: boolean;
  error?: string;
  /** 发送后本局剩余次数（null=无限） */
  remaining?: number | null;
}

const CHAT_HISTORY_LIMIT = 50;
const MINUTE_MS = 60_000;

/** 清理过期的每分钟时间戳（滑动窗口）。 */
function pruneTimestamps(timestamps: number[], now: number): number[] {
  const cutoff = now - MINUTE_MS;
  return timestamps.filter((t) => t >= cutoff);
}

/** 验证并记录一条聊天消息。 */
export function addChatMessage(
  roomId: string,
  playerId: string,
  text: string,
): ChatValidation {
  const room = roomList.get(roomId);
  if (!room) return { ok: false, error: '房间不存在' };

  const chat = room.config.chat;
  if (!chat.enabled) return { ok: false, error: '聊天已关闭' };
  // 聊天仅在游戏中可用(非大厅/结算阶段)
  if (room.status !== '进行中') return { ok: false, error: '聊天仅在游戏中可用' };

  // 白名单校验
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: '消息不能为空' };

  if (chat.whitelistOnly && !chat.whitelist.includes(trimmed)) {
    return { ok: false, error: '只能发送白名单内的消息' };
  }

  // 字数校验
  if (chat.maxChars > 0 && trimmed.length > chat.maxChars) {
    return { ok: false, error: `每条消息最多 ${chat.maxChars} 字` };
  }

  const now = Date.now();
  let usage = room.chatUsage.get(playerId);
  if (!usage) {
    usage = { total: 0, timestamps: [] };
    room.chatUsage.set(playerId, usage);
  }

  // 每局上限
  if (chat.maxPerGame > 0 && usage.total >= chat.maxPerGame) {
    return { ok: false, error: `本局消息上限 ${chat.maxPerGame} 条已用尽` };
  }

  // 每分钟上限（滑动窗口）
  if (chat.maxPerMinute > 0) {
    usage.timestamps = pruneTimestamps(usage.timestamps, now);
    if (usage.timestamps.length >= chat.maxPerMinute) {
      return { ok: false, error: `每分钟最多 ${chat.maxPerMinute} 条` };
    }
  }

  // 记录用量
  usage.total++;
  usage.timestamps.push(now);

  // 确定座次（从座位表派生，保证与座次顺序一致）
  const seatIndex = room.seats.indexOf(playerId);
  if (seatIndex < 0) return { ok: false, error: '不在房间中' };

  // 存入历史
  const entry = { playerId, seatIndex, text: trimmed, timestamp: now };
  room.chatHistory.push(entry);
  if (room.chatHistory.length > CHAT_HISTORY_LIMIT) {
    room.chatHistory.shift();
  }

  const remaining = chat.maxPerGame > 0 ? chat.maxPerGame - usage.total : null;
  return { ok: true, remaining };
}

/** 获取聊天历史（供重连）。 */
export function getChatHistory(roomId: string): Array<{
  playerId: string;
  seatIndex: number;
  text: string;
  timestamp: number;
}> {
  const room = roomList.get(roomId);
  return room ? [...room.chatHistory] : [];
}

/** 重置聊天用量（开局/重开时调用）。 */
export function resetChatUsage(roomId: string): void {
  const room = roomList.get(roomId);
  if (room) {
    room.chatUsage.clear();
    room.chatHistory = [];
  }
}
