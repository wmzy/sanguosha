// server/room.ts
import type { ConnectionSink } from './connection';
import type { RoomInfo, RoomConfig, ServerMessage } from './protocol';
import { DEFAULT_ROOM_CONFIG, normalizeRoomConfig } from './protocol';
import { createRng } from '../engine/util/rng';
import { register } from './lifecycles';
import { createLogger } from './logger';
import { verifyPassword } from './auth/password';

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
  /** 进房密码哈希(scrypt `salt:hash`);null=无密码。永不存明文、永不下发客户端。 */
  passwordHash: string | null;
  /** 座位表：seats[i] = 座次 i 的 playerId，null=空座。长度始终 = maxPlayers */
  seats: (string | null)[];
  /** 成员显示名:playerId → 用户昵称(登录用户 displayName;调试房间不维护)。
   *  playerId 是稳定 userId,展示层一律经此映射取名。 */
  playerNames: Map<string, string>;
  /** 待处理座位交换请求：requesterId → { targetSeat, expiresAt, timer } */
  pendingSeatSwaps: Map<string, { targetSeat: number; expiresAt: number; timer: ReturnType<typeof setTimeout> }>;
  /** 近期离开成员表：playerId → { at: 离开时刻 ms, role: 离开时身份 }。
   *  等待中/已结束阶段 SSE 断线会立即走 leaveRoom/removeSpectator 清空三名单
   *  (seats/playerNames/spectators)，而浏览器 EventSource 约 3s 自动重连只打
   *  stream 端点、不重走 POST /join——若无此表，重连会被 SSE 成员门禁 403 拒绝，
   *  且 EventSource 对非 2xx 永久失败，用户只能手动重进。此表为「刚被清理但
   *  马上回来」的合法成员保留短窗口成员资格(见 RECENT_LEAVE_GRACE_MS)。
   *  仅断线路径写入(主动退出/被踢不记录)；进行中状态不查此表(座位宽限期已
   *  覆盖，不放宽越权语义)；过期条目由读写两侧懒清理；纯内存不持久化
   *  (服务器重启路径由 DB 持久化的 playerNames 覆盖)。 */
  recentlyLeft: Map<string, { at: number; role: 'player' | 'spectator' }>;
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
    playerNames: Object.fromEntries(room.playerNames),
    pendingSeatSwaps: Object.fromEntries(
      [...room.pendingSeatSwaps.entries()].map(([id, v]) => [
        id,
        { targetSeat: v.targetSeat, expiresAt: v.expiresAt },
      ]),
    ),
    hasPassword: room.passwordHash !== null,
  };
}

/** 获取玩家当前座次下标（-1=不在座位表中）。 */
export function getPlayerSeat(room: Room, playerId: string): number {
  return room.seats.indexOf(playerId);
}

/** 校验进房密码。无密码房间恒过;有密码房间需明文匹配(scrypt,timingSafeEqual)。 */
export async function checkRoomPassword(
  room: Room,
  password: string | undefined,
): Promise<boolean> {
  if (!room.passwordHash) return true;
  if (!password) return false;
  return verifyPassword(password, room.passwordHash);
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
  passwordHash: string | null = null,
  hostName?: string | null,
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
    recentlyLeft: new Map(),
    passwordHash,
    playerNames: hostName ? new Map([[hostId, hostName]]) : new Map(),
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
    recentlyLeft: new Map(),
    passwordHash: null,
    playerNames: new Map(),
  };
  roomList.set(id, room);
  return room;
}

/** 已占用的座位数（权威的"当前玩家数"，与客户端 playerCount 一致）。
 *  用 seats 而非 players.size：seats 是"座位"概念，maxPlayers 本质是座位数；
 *  players.size 含连接 sink，可能含幽灵连接/断线残留，不适合做容量判断。 */
function occupiedSeatCount(room: Room): number {
  let n = 0;
  for (const s of room.seats) if (s !== null) n++;
  return n;
}

/** 清理该 playerId 的旁观者身份（spectators/viewGrants/pendingViewRequests）。
 *  身份互斥保证：加入玩家前先清旁观，避免同一 playerId 同时存在于 players 和 spectators。 */
function clearSpectatorMembership(room: Room, playerId: string): void {
  room.spectators.delete(playerId);
  room.viewGrants.delete(playerId);
  room.pendingViewRequests.delete(playerId);
}

export function joinRoom(
  roomId: string,
  playerId: string,
  sink: ConnectionSink,
  displayName?: string | null,
): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  // 显示名在所有路径(复用座位/新入座)统一刷新——重连时若用户已改名则以最新为准
  if (displayName) room.playerNames.set(playerId, displayName);
  // 「已结束」(上一局打完,等房主再来一局)同样允许加入空座——否则退出房间的玩家
  // 无法重新加入,只能旁观(游戏结束后 status 停留在 已结束,直到房主重置)。
  if (room.status !== '等待中' && room.status !== '已结束') return null;
  if (room.players.has(playerId)) return null;

  // 如果玩家已在 seats 中（SSE 断开重连时 seats 残留），复用已有座位
  const existingSeat = room.seats.indexOf(playerId);
  if (existingSeat >= 0) {
    room.players.set(playerId, sink);
    // 身份互斥：复用座位时清理可能残留的旁观者身份
    clearSpectatorMembership(room, playerId);
    // 重新入会成为正式成员，撤销可能残留的断线宽限条目
    room.recentlyLeft.delete(playerId);
    return room;
  }

  // 新玩家加入：检查人数上限（用已占座位数，与客户端 playerCount 一致）
  if (occupiedSeatCount(room) >= room.maxPlayers) return null;

  room.players.set(playerId, sink);
  // 身份互斥：加入玩家前清理可能残留的旁观者身份（如刷新前是旁观者）
  clearSpectatorMembership(room, playerId);
  // 重新入会成为正式成员，撤销可能残留的断线宽限条目
  room.recentlyLeft.delete(playerId);
  // 分配首个空座位
  const emptySeat = room.seats.indexOf(null);
  if (emptySeat >= 0) {
    room.seats[emptySeat] = playerId;
  } else {
    // seats 已满但 occupiedSeatCount 未满（异常状态）: 追加座位
    room.seats.push(playerId);
  }
  return room;
}

export function addRoom(room: Room): void {
  roomList.set(room.id, room);
}

/** 从房间成员结构中移除一名玩家（players/seats/ready/交换请求）。
 *  不处理房主转移、房间销毁或 DB 同步——由调用方决定。
 *  leaveRoom 与 kickPlayer 共用此逻辑。 */
function removePlayerMembership(room: Room, playerId: string): void {
  room.players.delete(playerId);
  room.readyPlayers.delete(playerId);
  const seatIdx = room.seats.indexOf(playerId);
  if (seatIdx >= 0) room.seats[seatIdx] = null;
  cancelSeatSwapInternal(room, playerId);
  // 取消指向该玩家（现已空）座位的交换请求
  for (const [reqId, swap] of room.pendingSeatSwaps) {
    if (room.seats[swap.targetSeat] === null) {
      clearTimeout(swap.timer);
      room.pendingSeatSwaps.delete(reqId);
    }
  }
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

export function leaveRoom(
  roomId: string,
  playerId: string,
  /** 'disconnect'=SSE 断线触发(记入近期离开宽限表)；'explicit'=主动退出/换房/清理
   *  (不记录——客户端已显式关闭连接或被踢，不存在自动重连诉求，被踢者不得借窗口回房)。 */
  reason: 'disconnect' | 'explicit' = 'explicit',
): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;

  removePlayerMembership(room, playerId);
  // 仍在旁观(如玩家身份被顶替后转旁观)则保留显示名;彻底离开才清除
  if (!room.spectators.has(playerId)) {
    room.playerNames.delete(playerId);
    // 断线路径记入宽限表：EventSource 自动重连只打 stream 端点、不重走 POST /join，
    // 若无此记录会被 SSE 成员门禁 403 拒绝且永久失败(见 Room.recentlyLeft 注释)。
    if (reason === 'disconnect') recordRecentLeave(room, playerId, 'player');
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

/** 房主踢出指定成员（占座玩家或旁观者）。仅等待中允许。
 *  返回被踢成员的连接 sink（供调用方发送 player_kicked 后关闭）。
 *  校验失败返回 null：房间不存在 / 非等待中 / 调用者非房主 / 目标不在房间 / 踢自己。
 *  踢出后不转移房主、不销毁房间（房主仍在）。 */
export function kickPlayer(
  roomId: string,
  hostId: string,
  targetPlayerId: string,
): { room: Room; kickedSink: ConnectionSink | null } | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  if (room.status !== '等待中') return null;
  // 仅房主可踢人（调试房间无房主，不允许踢人）
  if (room.hostId === null || room.hostId !== hostId) return null;
  // 不能踢自己
  if (targetPlayerId === hostId) return null;

  const isPlayer = room.players.has(targetPlayerId);
  const isSpectator = room.spectators.has(targetPlayerId);
  if (!isPlayer && !isSpectator) return null;

  const kickedSink = isPlayer
    ? (room.players.get(targetPlayerId) ?? null)
    : (room.spectators.get(targetPlayerId) ?? null);

  if (isPlayer) {
    removePlayerMembership(room, targetPlayerId);
  } else {
    room.spectators.delete(targetPlayerId);
    room.viewGrants.delete(targetPlayerId);
    room.pendingViewRequests.delete(targetPlayerId);
  }
  room.playerNames.delete(targetPlayerId);

  roomChangeHandler?.(room, 'update');
  return { room, kickedSink };
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
  // 仅占座玩家可准备(seats 是权威座位表;players 是连接层,建房后 SSE 连接前为空)。
  // 无此守卫时,任意字符串会被塞进 readyPlayers,
  // 使 allReady 的 size 相等判断永假 → 房间永久无法开局。
  if (!room.seats.includes(playerId)) return false;

  room.readyPlayers.add(playerId);
  return true;
}

export function unsetReady(roomId: string, playerId: string): boolean {
  const room = roomList.get(roomId);
  if (room?.status !== '等待中') return false;
  // 同 setReady:非本房玩家的取消请求直接拒绝
  if (!room.seats.includes(playerId)) return false;

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
      hasPassword: room.passwordHash !== null,
      playerNames: Object.fromEntries(room.playerNames),
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

/** SSE 重连补座次：等待中 + 非调试 + 玩家不在 seats + 有空座 → 补到首个空座。
 *  返回是否补了座(用于触发 room_state 广播)。
 *  修复服务器重启后 players 满 / seats 空的幽灵连接:正常流程先 joinRoom(分配座次)
 *  再连 SSE,但重启后 DB 不恢复 seats,客户端重连只走 SSE 时 players.set 却不分配座次,
 *  导致 joinRoom/switchRole 按 players.size 判满时锁死房间。 */
export function ensureSeatOnReconnect(room: Room, playerId: string): boolean {
  if (room.status !== '等待中' || room.isDebug) return false;
  if (room.seats.indexOf(playerId) >= 0) return false;
  const emptySeat = room.seats.indexOf(null);
  if (emptySeat < 0) return false;
  room.seats[emptySeat] = playerId;
  return true;
}

/** 近期离开宽限窗口时长(ms)：等待中/已结束阶段断线的成员，其 EventSource 自动
 *  重连(不重走 POST /join)在此窗口内仍视作成员。须显著大于心跳间隔(10s)+
 *  EventSource 重试间隔(约 3s)，覆盖网络抖动/休眠唤醒后的首次自动重连。 */
export const RECENT_LEAVE_GRACE_MS = 60_000;

/** 记录断线离开成员(带离开时身份，供重连后归位玩家/旁观分支)。
 *  写入前懒清理过期项，防止表随断线次数无限增长(房间生命周期内条目数 ≤ 成员数)。 */
function recordRecentLeave(room: Room, playerId: string, role: 'player' | 'spectator'): void {
  const now = Date.now();
  for (const [pid, entry] of room.recentlyLeft) {
    if (now - entry.at >= RECENT_LEAVE_GRACE_MS) room.recentlyLeft.delete(pid);
  }
  room.recentlyLeft.set(playerId, { at: now, role });
}

/** 查询 playerId 的近期离开宽限条目；已过期则顺手懒清理并返回 null。 */
export function getRecentLeaveGrace(
  room: Room,
  playerId: string,
): { role: 'player' | 'spectator' } | null {
  const entry = room.recentlyLeft.get(playerId);
  if (!entry) return null;
  if (Date.now() - entry.at >= RECENT_LEAVE_GRACE_MS) {
    room.recentlyLeft.delete(playerId);
    return null;
  }
  return entry;
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

/** 外部直接改 Room 字段后(如 rest.ts 改 passwordHash)触发持久化/广播。 */
export function notifyRoomChanged(room: Room, action: 'create' | 'update' | 'delete'): void {
  roomChangeHandler?.(room, action);
}

/** 用户改名后同步所有房间内的显示名并广播 room_state(个人页改名 → 房间内实时生效)。 */
export function applyDisplayName(userId: string, displayName: string): void {
  for (const room of roomList.values()) {
    if (!room.playerNames.has(userId)) continue;
    room.playerNames.set(userId, displayName);
    broadcastMessage(room, buildRoomState(room));
    if (room.roomType === 'normal') roomChangeHandler?.(room, 'update');
  }
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
  // 与 moveSeat/requestSeatSwap 同款守卫:仅等待中可换座。
  // 缺此检查时,开局瞬间点「接受」会在对局进行中改写 seats,
  // 破坏断线重连的 ensureSeatOnReconnect 归位与座次显示。
  if (room.status !== '等待中') return null;

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

/** 以旁观者身份加入房间。不占 maxPlayers 名额。
 *  身份互斥：若该 playerId 当前是玩家（占座），先释放座位转为旁观，避免同一个人
 *  同时存在于 players 和 spectators（刷新/autoJoin 降级旁观场景常见）。 */
export function joinAsSpectator(
  roomId: string,
  spectatorId: string,
  sink: ConnectionSink,
  displayName?: string | null,
): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  // 清理残留的玩家身份：释放座位、移出 players/ready/交换请求
  if (room.players.has(spectatorId) || room.seats.includes(spectatorId)) {
    removePlayerMembership(room, spectatorId);
  }
  room.spectators.set(spectatorId, sink);
  if (displayName) room.playerNames.set(spectatorId, displayName);
  // 重新入房成为正式旁观，撤销可能残留的断线宽限条目
  room.recentlyLeft.delete(spectatorId);
  return room;
}

/** 旁观者离开/断线：清理连接、授权和待处理申请。
 *  reason 语义同 leaveRoom('disconnect' 记入近期离开宽限表,见 Room.recentlyLeft)。 */
export function removeSpectator(
  roomId: string,
  spectatorId: string,
  reason: 'disconnect' | 'explicit' = 'explicit',
): Room | null {
  const room = roomList.get(roomId);
  if (!room) return null;
  room.spectators.delete(spectatorId);
  room.viewGrants.delete(spectatorId);
  room.pendingViewRequests.delete(spectatorId);
  // 仍在座位上(身份互斥的另一半不存在,防御性判断)则保留;否则彻底清除
  if (!room.seats.includes(spectatorId)) {
    room.playerNames.delete(spectatorId);
    if (reason === 'disconnect') recordRecentLeave(room, spectatorId, 'spectator');
  }
  return room;
}

/** 切换玩家身份。player↔spectator。「等待中」与「已结束」(上一局打完等重置)均允许——
 *  结束后旁观者点击空座位可直接入座,无需等房主点「再来一局」。
 *  身份互斥：切换后确保 playerId 只在一方（players 或 spectators），不留残留。 */
export function switchRole(
  roomId: string,
  playerId: string,
  newRole: 'player' | 'spectator',
  seat?: number,
): { room: Room; success: boolean } {
  const room = roomList.get(roomId);
  if (!room) return { room: null as never, success: false };
  if (room.status !== '等待中' && room.status !== '已结束') return { room, success: false };

  if (newRole === 'spectator') {
    // player → spectator
    const sink = room.players.get(playerId);
    if (!sink) return { room, success: false };
    // 完整移除玩家身份（players/seats/ready/交换请求）
    removePlayerMembership(room, playerId);
    room.spectators.set(playerId, sink);
    // 房主切旁观仍保留 hostId（管理权限不变）
    return { room, success: true };
  } else {
    // spectator → player
    const sink = room.spectators.get(playerId);
    if (!sink) return { room, success: false };
    // 容量判断用已占座位数（与客户端 playerCount 一致）。
    // 用 players.size 会因幽灵连接/断线残留误判满员。
    if (occupiedSeatCount(room) >= room.maxPlayers) return { room, success: false };
    // 指定座位时校验：必须有效且为空
    if (seat !== undefined) {
      if (seat < 0 || seat >= room.seats.length || room.seats[seat] !== null) {
        return { room, success: false };
      }
    }
    clearSpectatorMembership(room, playerId);
    room.players.set(playerId, sink);
    // 占据指定座位（或首个空座位）
    const emptySeat = seat ?? room.seats.indexOf(null);
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
