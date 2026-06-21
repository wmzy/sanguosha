// server/app.ts
import { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { serialize } from './protocol';
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
  type Room,
} from './room';
import { GameSession } from './session';
import { createLogger } from './logger';
import { listPersistedRooms, loadRoom, deletePersistedRoom, restoreFromLog } from './persistence';
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
      const room: Room = {
        id: roomId,
        name: persisted.roomName || `恢复-${roomId}`,
        players: new Map(),
        maxPlayers: persisted.maxPlayers || state.players.length,
        status: '进行中',
        hostId: persisted.hostId,
        readyPlayers: new Set(),
        isDebug: persisted.debug,
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

void restorePersistedRooms();

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
    const room = createDebugRoom(`调试${playerCount}人`, playerCount);

    const session = new GameSession(room, true);
    session.pendingPlayerCount = playerCount;
    gameSessions.set(room.id, session);

    return c.json({ roomId: room.id });
  } catch (err) {
    log.error('创建调试房间失败', { error: String(err) });
    return c.json({ error: `创建调试房间失败: ${String(err)}` }, 500);
  }
});

// WebSocket 消息处理
export function handleWsMessage(
  playerId: string,
  message: import('./protocol').ClientMessage,
  ws: WSContext,
): void {
  switch (message.type) {
    case 'create_room':
      handleCreateRoom(playerId, message.name, message.maxPlayers, ws);
      break;
    case 'join_room':
      handleJoinRoom(playerId, message.roomId, ws);
      break;
    case 'list_rooms':
      ws.send(serialize({ type: 'room_list', rooms: getRoomList(message.filter) }));
      break;
    case 'ready':
      handleReady(playerId);
      break;
    case 'start_game':
      void handleStartGame(playerId);
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
      void handleCreateDebugRoom(playerId, message.playerCount, ws);
      break;
    case 'join_debug_room':
      void handleJoinDebugRoom(playerId, message.roomId, message.lastSeq ?? 0, ws);
      break;
    case 'delete_room':
      handleDeleteRoom(playerId);
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
  ws: WSContext,
): void {
  const existingRoom = findRoomByPlayerId(playerId);
  if (existingRoom) {
    leaveRoom(existingRoom.id, playerId);
    playerRoomMap.delete(playerId);
  }

  const room = createRoom(name, maxPlayers, playerId, ws);
  playerRoomMap.set(playerId, room.id);

  ws.send(serialize({
    type: 'room_joined',
    roomId: room.id,
    playerId,
  }));
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
}

function handleReady(playerId: string): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;
  setReady(roomId, playerId);
}

async function handleStartGame(playerId: string): Promise<void> {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const room = getRoom(roomId);
  if (!room) return;

  if (room.hostId !== playerId) {
    const ws = room.players.get(playerId);
    if (ws) ws.send(serialize({ type: 'error', message: '只有房主可以开始游戏' }));
    return;
  }

  if (!allReady(roomId)) {
    const ws = room.players.get(playerId);
    if (ws) ws.send(serialize({ type: 'error', message: '还有玩家未准备' }));
    return;
  }

  const session = new GameSession(room);
  gameSessions.set(roomId, session);

  if (await session.startGame()) {
    broadcastMessage(room, serialize({ type: 'game_started' }));
  }
}

function handleAction(playerId: string, action: import('../engine/types').ClientMessage): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const session = gameSessions.get(roomId);
  if (!session) return;

  void session.handleAction(playerId, action);
}

function handleReorderHand(playerId: string, order: string[]): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const session = gameSessions.get(roomId);
  if (!session) return;

  void session.handleReorderHand(playerId, order);
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

  gameSessions.delete(roomId);
}

function handleDisconnect(playerId: string): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const room = getRoom(roomId);
  // 调试房间：保留映射和会话（供重连使用），手动删除时才清理
  if (room?.isDebug) {
    return;
  }

  // 真人游戏：通知 session 进入重连宽限期，由 session 决定何时真正结束游戏
  const session = gameSessions.get(roomId);
  if (session) {
    session.handleDisconnect(playerId);
  }
}

async function handleCreateDebugRoom(playerId: string, playerCount: number, ws: WSContext): Promise<void> {
  if (playerCount < 2 || playerCount > 8) {
    ws.send(serialize({ type: 'error', message: '玩家人数须在2-8之间' }));
    return;
  }
  const room = createDebugRoom(`调试${playerCount}人`, playerCount);
  const session = new GameSession(room, true);
  session.pendingPlayerCount = playerCount;
  gameSessions.set(room.id, session);
  // host 自动 join：和 handleJoinDebugRoom 走相同流程
  await handleJoinDebugRoom(playerId, room.id, 0, ws);
}

function handleDeleteRoom(playerId: string): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;
  const room = getRoom(roomId);
  if (!room?.isDebug) return;
  const session = gameSessions.get(roomId);
  if (session) {
    void session.destroy();
    gameSessions.delete(roomId);
  }
  const playerIds = [...room.players.keys()];
  for (const pid of playerIds) {
    playerRoomMap.delete(pid);
    leaveRoom(roomId, pid);
  }
  deleteRoom(roomId);
  void deletePersistedRoom(roomId);
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

  const pendingPlayerCount = session.pendingPlayerCount;
  if (pendingPlayerCount != null) {
    session.pendingPlayerCount = undefined;
    await session.startGame(pendingPlayerCount);
    const seatIndex = session.assignDebugSeat(playerId);
    ws.send(serialize({ type: 'room_joined', roomId, playerId, seatIndex }));
  } else {
    // 后续连接的玩家分配座次
    const seatIndex = session.assignDebugSeat(playerId);
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
