// server/app.ts
import { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { serialize } from './protocol';
import type { RoomConfig } from './protocol';
import { normalizeRoomConfig } from './protocol';
import {
  createRoom,
  createDebugRoom,
  joinRoom,
  joinDebugRoom,
  leaveRoom,
  setReady,
  allReady,
  getRoom,
  getRoomList,
  deleteRoom,
  findRoomByPlayerId,
  broadcastMessage,
  addRoom,
  setSessionChecker,
  updateConfig,
  type Room,
} from './room';
import { GameSession } from './session';
import { createLogger } from './logger';
import { listPersistedRooms, loadRoom, deletePersistedRoom, restoreFromLog } from './persistence';
import { createSnapshot, patchSnapshotDescription, type CreateSnapshotRequest } from './snapshot';
import { cors, requestLogger, errorHandler, rateLimit } from './middleware';
// 新 ENGINE-DESIGN 不再需要 protocol-adapter(回应 action 走 ClientMessage 直接 dispatch)

const log = createLogger('ws');

const app = new Hono();
app.use('*', cors);
app.use('*', requestLogger);
app.use('*', rateLimit);
app.onError(errorHandler);

// 游戏会话管理
const gameSessions = new Map<string, GameSession>();

// 玩家到房间的映射
const playerRoomMap = new Map<string, string>();

import { register as registerLifecycle } from './lifecycles';

registerLifecycle('gameSessions', gameSessions, () => {
  gameSessions.clear();
});
registerLifecycle('playerRoomMap', playerRoomMap, () => {
  playerRoomMap.clear();
});

const IDLE_ROOM_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** 广播房间准备状态(room_state)给房间内所有连接。
 *  调试房间配置阶段:玩家加入/离开/准备/配置更新时触发。 */
function broadcastRoomState(room: Room): void {
  broadcastMessage(room, serialize({
    type: 'room_state',
    readyPlayers: [...room.readyPlayers],
    playerIds: [...room.players.keys()],
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    config: room.config,
  }));
}

/** 广播房间配置变更(room_config)。 */
function broadcastRoomConfig(room: Room): void {
  broadcastMessage(room, serialize({ type: 'room_config', config: room.config }));
}

function cleanupIdleRooms(): void {
  const now = Date.now();
  const stale: string[] = [];
  for (const [roomId, session] of gameSessions) {
    if (now - session.getLastActivityAt() > IDLE_ROOM_TTL_MS) {
      stale.push(roomId);
    }
  }
  for (const roomId of stale) {
    log.info(`清理闲置房间 ${roomId}`);
    const session = gameSessions.get(roomId);
    session?.destroy();
    gameSessions.delete(roomId);
    const room = getRoom(roomId);
    if (room) {
      const playerIds = [...room.players.keys()];
      for (const pid of playerIds) {
        leaveRoom(roomId, pid);
        playerRoomMap.delete(pid);
      }
    }
    for (const [pid, rid] of playerRoomMap) {
      if (rid === roomId) playerRoomMap.delete(pid);
    }
  }
}

setInterval(cleanupIdleRooms, CLEANUP_INTERVAL_MS).unref();

async function restorePersistedRooms(): Promise<void> {
  const roomIds = await listPersistedRooms();
  log.info(`启动恢复：发现 ${roomIds.length} 个持久化房间`);
  // skill 注册表是 state-bound(WeakMap 外挂),每个房间的 state 自带独立注册表,
  // 无需启动时清理全局表。bootstrap 会为每个 state 注册各自的技能实例。
  // 清理超过 1 小时没活动的房间(debug 房间不需要跨重启保留)
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  for (const roomId of roomIds) {
    try {
      const persisted = await loadRoom(roomId);
      if (!persisted) continue;
      // 跳过超时的 debug 房间
      if (persisted.debug && persisted.state?.startedAt && (now - persisted.state.startedAt > ONE_HOUR)) {
        log.info(`跳过过期 debug 房间 ${roomId}`);
        await deletePersistedRoom(roomId);
        continue;
      }
      const state = restoreFromLog(persisted);
      // 兼容新旧 GameState 格式
      if (!state.players || !Array.isArray(state.players)) {
        log.info(`房间 ${roomId} 数据格式不兼容,跳过`);
        await deletePersistedRoom(roomId);
        continue;
      }
      // 从持久化 state.config 恢复房间配置;旧数据无 config 时用默认值
      const restoredConfig = (state.config && typeof state.config.timeoutScale === 'number')
        ? { ...normalizeRoomConfig(undefined), timeoutScale: state.config.timeoutScale, name: persisted.roomName || `恢复-${roomId}` }
        : { ...normalizeRoomConfig(undefined), name: persisted.roomName || `恢复-${roomId}` };
      const room: Room = {
        id: roomId,
        name: persisted.roomName || `恢复-${roomId}`,
        players: new Map(),
        maxPlayers: persisted.maxPlayers || state.players.length,
        status: '进行中',
        hostId: persisted.hostId,
        readyPlayers: new Set(),
        isDebug: persisted.debug,
        config: restoredConfig,
      };
      addRoom(room);
      const session = new GameSession(room, persisted.debug);
      await session.restoreState(state, persisted.actionLog);
      gameSessions.set(roomId, session);
      log.info(`恢复房间 ${roomId}（${state.players.length} 名玩家，${persisted.actionLog.length} 步操作）`);
    } catch (err) {
      log.info(`房间 ${roomId} 恢复失败: ${err},删除`);
      await deletePersistedRoom(roomId);
    }
  }
}

void restorePersistedRooms().catch(err => {
  const e = err instanceof Error ? err : new Error(String(err));
  log.error('restorePersistedRooms failed', { error: e.stack ?? String(e) });
});

// REST API
app.get('/api/rooms', (c) => {
  const typeParam = c.req.query('type');
  const type = typeParam === 'debug' || typeParam === 'multiplayer' ? typeParam : undefined;
  return c.json(getRoomList(type));
});

app.get('/api/rooms/:id', (c) => {
  const id = c.req.param('id');
  const room = getRoom(id);
  if (!room) return c.json({ error: '房间不存在' }, 404);
  return c.json({
    id: room.id,
    name: room.name,
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    status: room.status,
  });
});

app.get('/api/rooms/:id/log', (c) => {
  const id = c.req.param('id');
  const session = gameSessions.get(id);
  if (!session) return c.json({ error: '会话不存在' }, 404);
  const gameLog = session.getGameLog();
  if (!gameLog) return c.json({ error: '无游戏日志' }, 404);
  return c.json(gameLog);
});

app.delete('/api/rooms/:id', async (c) => {
  const id = c.req.param('id');
  const room = getRoom(id);
  if (!room) return c.json({ error: '房间不存在' }, 404);
  if (!room.isDebug) return c.json({ error: '只能删除调试房间' }, 403);

  const session = gameSessions.get(id);
  if (session) {
    await session.destroy();
    gameSessions.delete(id);
  }
  const playerIds = [...room.players.keys()];
  for (const pid of playerIds) {
    playerRoomMap.delete(pid);
    leaveRoom(id, pid);
  }
  deleteRoom(id);
  await deletePersistedRoom(id);

  return c.json({ success: true });
});

app.post('/api/rooms', async (c) => {
  const raw = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const name = (typeof raw.name === 'string' ? raw.name.trim() : '') || `房间${Date.now().toString(36)}`;
  const maxPlayers = typeof raw.maxPlayers === 'number' ? raw.maxPlayers : 2;
  if (maxPlayers < 2 || maxPlayers > 8) {
    return c.json({ error: '最大玩家数须在2-8之间' }, 400);
  }

  try {
    const room = createRoom(name, maxPlayers, '', null as never);
    return c.json({ roomId: room.id });
  } catch (err) {
    log.error('创建房间失败', { error: String(err) });
    return c.json({ error: `创建房间失败: ${String(err)}` }, 500);
  }
});

app.post('/api/rooms/:id/join', (c) => {
  const id = c.req.param('id');
  const room = getRoom(id);
  if (!room) return c.json({ error: '房间不存在' }, 404);
  if (room.isDebug) return c.json({ error: '调试房间请使用调试入口' }, 400);
  if (room.players.size >= room.maxPlayers) return c.json({ error: '房间已满' }, 400);
  if (room.status !== '等待中') return c.json({ error: '游戏已开始' }, 400);
  return c.json({ roomId: room.id });
});

app.post('/api/debug-room', async (c) => {
  const raw = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const playerCount = typeof raw.playerCount === 'number' ? raw.playerCount : 5;
  if (playerCount < 2 || playerCount > 8) {
    return c.json({ error: '玩家人数须在2-8之间' }, 400);
  }

  try {
    const config = normalizeRoomConfig(raw.config);
    const room = createDebugRoom(config.name || `调试${playerCount}人`, playerCount, config);

    // 创建占位 session(不 startGame)。hasSession 检查需要它存在,房间才会出现在列表。
    // 进入「配置+准备」阶段;所有座次就绪后由 start_game 触发 startGame。
    const session = new GameSession(room, true);
    gameSessions.set(room.id, session);

    return c.json({ roomId: room.id });
  } catch (err) {
    log.error('创建调试房间失败', { error: String(err) });
    return c.json({ error: `创建调试房间失败: ${String(err)}` }, 500);
  }
});

// Debug 快照:保存前后端完整游戏状态到 data/snapshots/
app.post('/api/snapshot', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!body || typeof body.roomId !== 'string') {
    return c.json({ error: '缺少 roomId' }, 400);
  }
  if (typeof body.perspective !== 'number'
    || typeof body.frontendSeqs !== 'object' || body.frontendSeqs === null
    || typeof body.frontendViews !== 'object' || body.frontendViews === null) {
    return c.json({ error: '缺少 perspective/frontendSeqs/frontendViews' }, 400);
  }
  const session = gameSessions.get(body.roomId);
  if (!session) return c.json({ error: '会话不存在' }, 404);
  const result = await createSnapshot(session, body as unknown as CreateSnapshotRequest);
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

app.patch('/api/snapshot/:id', async (c) => {
  const snapshotId = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (!body || typeof body.description !== 'string') {
    return c.json({ error: '缺少 description' }, 400);
  }
  const result = await patchSnapshotDescription(snapshotId, body.description);
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

// WebSocket 消息处理
export function handleWsMessage(
  playerId: string,
  message: import('./protocol').ClientMessage,
  ws: WSContext,
): void {
  switch (message.type) {
    case 'create_room':
      handleCreateRoom(playerId, message.name, message.maxPlayers, message.config, ws);
      break;
    case 'join_room':
      handleJoinRoom(playerId, message.roomId, ws);
      break;
    case 'ready':
      handleReady(playerId);
      break;
    case 'start_game':
      void handleStartGame(playerId).catch(err => {
        const e = err instanceof Error ? err : new Error(String(err));
        log.error('handleStartGame failed', { playerId, error: e.stack ?? String(e) });
      });
      break;
    case 'restart_game':
      handleRestartGame(playerId);
      break;
    case 'action':
      handleAction(playerId, message.action);
      break;
    case 'reorder_hand':
      handleReorderHand(playerId, message.order);
      break;
    case 'leave_room':
      handleLeaveRoom(playerId);
      break;
    case 'reconnect':
      handleReconnect(playerId, message.playerId, message.lastSeq ?? 0, ws);
      break;
    case 'create_debug_room':
      handleCreateDebugRoom(playerId, message.config, message.playerCount, ws);
      break;
    case 'update_room_config':
      handleUpdateConfig(playerId, message.config);
      break;
    case 'join_debug_room':
      void handleJoinDebugRoom(playerId, message.roomId, message.lastSeq ?? 0, ws).catch(err => {
        const e = err instanceof Error ? err : new Error(String(err));
        log.error('handleJoinDebugRoom failed', { playerId, roomId: message.roomId, error: e.stack ?? String(e) });
      });
      break;
  }
}

export function handleWsOpen(playerId: string): void {
  log.info('玩家已连接', { playerId });
}

export function handleWsClose(playerId: string): void {
  log.info('玩家已断开', { playerId });
  handleDisconnect(playerId);
}

function handleCreateRoom(
  playerId: string,
  name: string,
  maxPlayers: number,
  config: RoomConfig | undefined,
  ws: WSContext,
): void {
  const existingRoom = findRoomByPlayerId(playerId);
  if (existingRoom) {
    leaveRoom(existingRoom.id, playerId);
    playerRoomMap.delete(playerId);
  }

  const room = createRoom(name, maxPlayers, playerId, ws, config);
  playerRoomMap.set(playerId, room.id);

  ws.send(serialize({
    type: 'room_joined',
    roomId: room.id,
    playerId,
  }));
  broadcastRoomState(room);
}

function handleJoinRoom(playerId: string, roomId: string, ws: WSContext): void {
  const existingRoom = findRoomByPlayerId(playerId);
  if (existingRoom) {
    leaveRoom(existingRoom.id, playerId);
    playerRoomMap.delete(playerId);
  }

  const room = joinRoom(roomId, playerId, ws);
  if (!room) {
    ws.send(serialize({ type: 'error', message: '无法加入房间' }));
    return;
  }

  playerRoomMap.set(playerId, roomId);

  ws.send(serialize({
    type: 'room_joined',
    roomId,
    playerId,
  }));

  broadcastMessage(
    room,
    serialize({ type: 'player_joined', playerId }),
    playerId,
  );
  broadcastRoomState(room);
}

function handleReady(playerId: string): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;
  const ok = setReady(roomId, playerId);
  if (!ok) return;
  const room = getRoom(roomId);
  if (!room) return;
  // 通知所有人该玩家已准备
  broadcastMessage(room, serialize({ type: 'player_ready', playerId }));
  broadcastRoomState(room);
}

/** 更新房间配置(仅房主;调试房间任意玩家)。 */
function handleUpdateConfig(playerId: string, config: RoomConfig): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;
  const room = getRoom(roomId);
  if (!room) return;
  const updated = updateConfig(roomId, config, playerId);
  if (!updated) {
    const ws = room.players.get(playerId);
    if (ws) ws.send(serialize({ type: 'error', message: '无法更新房间配置' }));
    return;
  }
  broadcastRoomConfig(room);
  broadcastRoomState(room);
}

async function handleStartGame(playerId: string): Promise<void> {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const room = getRoom(roomId);
  if (!room) return;

  // debug 房间无房主,任意座次可触发开始;普通房间仅房主
  if (!room.isDebug && room.hostId !== playerId) {
    const ws = room.players.get(playerId);
    if (ws) ws.send(serialize({ type: 'error', message: '只有房主可以开始游戏' }));
    return;
  }

  if (!allReady(roomId)) {
    const ws = room.players.get(playerId);
    if (ws) ws.send(serialize({ type: 'error', message: '还有玩家未准备' }));
    return;
  }

  // debug 房间:复用创建时已建好的占位 session;普通房间新建
  let session = room.isDebug ? gameSessions.get(roomId) ?? undefined : undefined;
  if (!session) {
    session = new GameSession(room, room.isDebug === true);
    gameSessions.set(roomId, session);
  }

  const count = room.isDebug ? room.maxPlayers : undefined;
  if (await session.startGame(count)) {
    broadcastMessage(room, serialize({ type: 'game_started' }));
  }
}

/** 游戏结束后重新进入「配置+准备」阶段(再来一局)。
 *  debug 房间任意座次可触发;复用同一 session,重置后由玩家重新准备 → start_game。 */
function handleRestartGame(playerId: string): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;
  const room = getRoom(roomId);
  if (!room) return;
  const session = gameSessions.get(roomId);
  if (!session) return;
  session.resetToLobby();
  broadcastRoomState(room);
}

/** WS 入口创建调试房间(与 REST /api/debug-room 等价)。 */
function handleCreateDebugRoom(
  playerId: string,
  config: RoomConfig | undefined,
  playerCount: number | undefined,
  ws: WSContext,
): void {
  const existingRoom = findRoomByPlayerId(playerId);
  if (existingRoom) {
    leaveRoom(existingRoom.id, playerId);
    playerRoomMap.delete(playerId);
  }
  const count = Math.min(Math.max(playerCount ?? 5, 2), 8);
  const normalized = normalizeRoomConfig(config);
  const room = createDebugRoom(normalized.name || `调试${count}人`, count, normalized);

  const session = new GameSession(room, true);
  gameSessions.set(room.id, session);

  playerRoomMap.set(playerId, room.id);
  // 创建者自动加入(第一个座次)
  joinDebugRoom(room.id, playerId, ws);
  const seatIndex = session.assignDebugSeat(playerId);

  ws.send(serialize({ type: 'room_joined', roomId: room.id, playerId, seatIndex }));
  broadcastRoomState(room);
}

function handleAction(playerId: string, action: import('../engine/types').ClientMessage): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const session = gameSessions.get(roomId);
  if (!session) return;

  void session.handleAction(playerId, action).catch(err => {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error('session.handleAction failed', { playerId, error: e.stack ?? String(e) });
  });
}

function handleReorderHand(playerId: string, order: string[]): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const session = gameSessions.get(roomId);
  if (!session) return;

  void session.handleReorderHand(playerId, order).catch(err => {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error('session.handleReorderHand failed', { playerId, error: e.stack ?? String(e) });
  });
}

// 新 ENGINE-DESIGN 不再需要 handleAsyncHookResponse

// 新 ENGINE-DESIGN 不再需要 handleResponse(回应走 action 消息)

function handleLeaveRoom(playerId: string): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const room = leaveRoom(roomId, playerId);
  playerRoomMap.delete(playerId);

  if (room) {
    broadcastMessage(room, serialize({ type: 'player_left', playerId }));
  }

  const session = gameSessions.get(roomId);
  if (session) {
    void session.destroy().catch(err => {
      const e = err instanceof Error ? err : new Error(String(err));
      log.error('session.destroy failed', { roomId, error: e.stack ?? String(e) });
    });
  }
  gameSessions.delete(roomId);
}

function handleDisconnect(playerId: string): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const room = getRoom(roomId);
  const session = gameSessions.get(roomId);
  if (session) {
    // session.handleDisconnect 内部按 debug/非 debug 分支处理:
    // debug 模式立即清理座次映射(避免幽灵连接占用座次),
    // 非debug 模式进入重连宽限期。
    session.handleDisconnect(playerId);
  }

  // debug 模式:playerId 一次性使用,清理映射防泄漏。
  // 非debug 模式:保留映射供 reconnect 消息恢复。
  if (room?.isDebug) {
    playerRoomMap.delete(playerId);
  }
}

async function handleJoinDebugRoom(playerId: string, roomId: string, lastSeq: number, ws: WSContext): Promise<void> {
  const room = getRoom(roomId);
  if (!room?.isDebug) {
    ws.send(serialize({ type: 'error', message: '房间不存在或不是调试房间' }));
    return;
  }

  const session = gameSessions.get(roomId);
  if (!session) {
    ws.send(serialize({ type: 'error', message: '游戏会话不存在' }));
    return;
  }

  const joined = joinDebugRoom(roomId, playerId, ws);
  if (!joined) {
    ws.send(serialize({ type: 'error', message: '加入调试房间失败' }));
    return;
  }
  playerRoomMap.set(playerId, roomId);

  // 刷新重连复用座次:被替换的旧连接需清理 session 映射,
  // 其座次由 assignDebugSeat 重新分配给新 playerId。
  if (joined.replacedPlayerId) {
    session.evictDebugPlayer(joined.replacedPlayerId);
    playerRoomMap.delete(joined.replacedPlayerId);
  }

  // 分配座次(配置阶段即可分配,不依赖 state)
  const seatIndex = session.assignDebugSeat(playerId);

  if (room.status === '等待中') {
    // 配置+准备阶段:发送 room_joined + 当前房间状态
    ws.send(serialize({ type: 'room_joined', roomId, playerId, seatIndex }));
    broadcastRoomState(room);
  } else {
    // 游戏已开始(刷新重连):发送 room_joined + 恢复视图
    session.reconnectPlayer(playerId, ws, lastSeq);
    ws.send(serialize({ type: 'room_joined', roomId, playerId, seatIndex }));
  }
}

function handleReconnect(currentPlayerId: string, previousPlayerId: string, lastSeq: number, ws: WSContext): void {
  const roomId = playerRoomMap.get(previousPlayerId);
  if (!roomId) {
    ws.send(serialize({ type: 'error', message: '没有找到可恢复的会话' }));
    return;
  }

  const session = gameSessions.get(roomId);
  if (!session) {
    ws.send(serialize({ type: 'error', message: '游戏会话已结束' }));
    return;
  }

  if (session.reconnectPlayer(previousPlayerId, ws, lastSeq)) {
    playerRoomMap.set(currentPlayerId, roomId);
    log.info('玩家重连成功', { previousPlayerId, currentPlayerId, lastSeq });
  } else {
    ws.send(serialize({ type: 'error', message: '重连失败' }));
  }
}

// 注册 session 检查器:getRoomList 用它过滤掉没有活跃 session 的房间
setSessionChecker((roomId) => gameSessions.has(roomId));

export default app;
