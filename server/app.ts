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
  findRoomByPlayerId,
  broadcastMessage,
  addRoom,
  type Room,
} from './room';
import { GameSession } from './session';
import { createLogger } from './logger';
import { listPersistedRooms, loadRoom, deletePersistedRoom, restoreToState } from './persistence';

const log = createLogger('ws');

const app = new Hono();

// 游戏会话管理
const gameSessions = new Map<string, GameSession>();

// 玩家到房间的映射
const playerRoomMap = new Map<string, string>();

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

function restorePersistedRooms(): void {
  const roomIds = listPersistedRooms();
  log.info(`启动恢复：发现 ${roomIds.length} 个持久化房间`);
  for (const roomId of roomIds) {
    const persisted = loadRoom(roomId);
    if (!persisted) continue;
    const state = restoreToState(persisted);
    if (state.meta.status === '已结束') {
      log.info(`房间 ${roomId} 已结束，删除落盘文件`);
      deletePersistedRoom(roomId);
      continue;
    }
    const room: Room = {
      id: roomId,
      name: persisted.roomName || `恢复-${roomId}`,
      players: new Map(),
      maxPlayers: persisted.maxPlayers || state.playerOrder.length,
      status: '进行中',
      hostId: persisted.hostId,
      readyPlayers: new Set(),
      isDebug: persisted.debug,
    };
    addRoom(room);
    const session = new GameSession(room, persisted.debug);
    session.restoreState(state, persisted.actionLog);
    gameSessions.set(roomId, session);
    log.info(`恢复房间 ${roomId}（${state.playerOrder.length} 名玩家，${persisted.actionLog.length} 步操作）`);
  }
}

restorePersistedRooms();

// REST API
app.get('/api/rooms', (c) => {
  return c.json(getRoomList());
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

app.delete('/api/rooms/:id', (c) => {
  const id = c.req.param('id');
  const room = getRoom(id);
  if (!room) return c.json({ error: '房间不存在' }, 404);
  if (!room.isDebug) return c.json({ error: '只能删除调试房间' }, 403);

  const session = gameSessions.get(id);
  if (session) {
    session.destroy();
    gameSessions.delete(id);
  }
  const playerIds = [...room.players.keys()];
  for (const pid of playerIds) {
    playerRoomMap.delete(pid);
    leaveRoom(id, pid);
  }

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
      ws.send(serialize({ type: 'room_list', rooms: getRoomList() }));
      break;
    case 'ready':
      handleReady(playerId);
      break;
    case 'start_game':
      handleStartGame(playerId);
      break;
    case 'action':
      handleAction(playerId, message.action);
      break;
    case 'response':
      handleResponse(playerId, message.promptId, message.choice);
      break;
    case 'leave_room':
      handleLeaveRoom(playerId);
      break;
    case 'reconnect':
      handleReconnect(playerId, message.playerId, ws);
      break;
    case 'create_debug_room':
      handleCreateDebugRoom(playerId, message.playerCount, ws);
      break;
    case 'join_debug_room':
      handleJoinDebugRoom(playerId, message.roomId, ws);
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

function handleStartGame(playerId: string): void {
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

  if (session.startGame()) {
    broadcastMessage(room, serialize({ type: 'game_started' }));
  }
}

function handleAction(playerId: string, action: import('../engine/types').GameAction): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const session = gameSessions.get(roomId);
  if (!session) return;

  session.handleAction(playerId, action);
}

function handleResponse(playerId: string, promptId: string, choice: unknown): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const session = gameSessions.get(roomId);
  if (!session) return;

  const playerName = session.getPlayerName(playerId);
  if (!playerName) return;

  const pending = session.getPending();
  if (!pending) return;

  if (pending.id !== promptId) {
    const ws = getRoom(roomId)?.players.get(playerId);
    ws?.send(serialize({ type: 'error', message: '响应已过期或 promptId 不匹配' }));
    return;
  }

  let action: import('../engine/types').GameAction;

  switch (pending.type) {
    case 'responseWindow':
    case 'dyingWindow': {
      const cardId = typeof choice === 'string' ? choice : undefined;
      action = { type: 'respond', player: playerName, cardId };
      break;
    }
    case 'discardPhase': {
      const cardIds = Array.isArray(choice) ? choice as string[] : [];
      action = { type: 'discard', player: playerName, cardIds };
      break;
    }
    case 'skillPrompt': {
      action = { type: 'skillChoice', player: playerName, choice: choice as import('../engine/types').Json };
      break;
    }
    case 'selectCard': {
      const cardIds = Array.isArray(choice) ? choice as string[] :
        typeof choice === 'string' ? [choice] : [];
      action = { type: 'respond', player: playerName, cardIds };
      break;
    }
    default:
      log.warn('未知 pending 类型', { pendingType: (pending as { type: string }).type });
      return;
  }

  session.handleAction(playerId, action);
}

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

function handleCreateDebugRoom(playerId: string, playerCount: number, ws: WSContext): void {
  try {
    const existing = findRoomByPlayerId(playerId);
    if (existing) {
      leaveRoom(existing.id, playerId);
      playerRoomMap.delete(playerId);
    }

    const room = createDebugRoom(`调试${playerCount}人`, playerCount);
    const joined = joinDebugRoom(room.id, playerId, ws);
    if (!joined) {
      ws.send(serialize({ type: 'error', message: '加入调试房间失败' }));
      return;
    }
    playerRoomMap.set(playerId, room.id);

    const session = new GameSession(room, true);
    gameSessions.set(room.id, session);
    session.startGame(playerCount);

    ws.send(serialize({ type: 'room_joined', roomId: room.id, playerId }));
  } catch (err) {
    log.error('创建调试房间失败', { error: String(err) });
    ws.send(serialize({ type: 'error', message: `创建调试房间失败: ${String(err)}` }));
  }
}

function handleDeleteRoom(playerId: string): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const room = getRoom(roomId);
  if (!room?.isDebug) return;

  const session = gameSessions.get(roomId);
  if (session) {
    session.destroy();
    gameSessions.delete(roomId);
  }

  leaveRoom(roomId, playerId);
  playerRoomMap.delete(playerId);
}

function handleJoinDebugRoom(playerId: string, roomId: string, ws: WSContext): void {
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
    session.startGame(pendingPlayerCount);
    ws.send(serialize({ type: 'room_joined', roomId, playerId }));
  } else {
    session.reconnectPlayer(playerId, ws);
    ws.send(serialize({ type: 'room_joined', roomId, playerId }));
    session.sendDebugGameState(playerId);
  }
}

function handleReconnect(currentPlayerId: string, previousPlayerId: string, ws: WSContext): void {
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

  if (session.reconnectPlayer(previousPlayerId, ws)) {
    playerRoomMap.set(currentPlayerId, roomId);
    log.info('玩家重连成功', { previousPlayerId, currentPlayerId });
  } else {
    ws.send(serialize({ type: 'error', message: '重连失败' }));
  }
}

export default app;
