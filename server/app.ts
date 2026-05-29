// server/app.ts
import { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { serialize } from './protocol';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  setReady,
  allReady,
  getRoom,
  getRoomList,
  findRoomByPlayerId,
  broadcastMessage,
} from './room';
import { GameSession } from './session';

const app = new Hono();

// 游戏会话管理
const gameSessions = new Map<string, GameSession>();

// 玩家到房间的映射
const playerRoomMap = new Map<string, string>();

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
  }
}

export function handleWsOpen(playerId: string): void {
  console.warn(`玩家 ${playerId} 已连接`);
}

export function handleWsClose(playerId: string): void {
  console.warn(`玩家 ${playerId} 已断开`);
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

function handleAction(playerId: string, action: import('../shared/types').PlayerAction): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const session = gameSessions.get(roomId);
  if (!session) return;

  session.handleAction(playerId, action);
}

function handleResponse(playerId: string, promptId: string, choice: unknown): void {
  console.warn(`玩家 ${playerId} 响应 ${promptId}:`, choice);
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

  const session = gameSessions.get(roomId);
  if (session) {
    session.handleDisconnect(playerId);
    gameSessions.delete(roomId);
  }

  const room = leaveRoom(roomId, playerId);
  playerRoomMap.delete(playerId);

  if (room) {
    broadcastMessage(room, serialize({ type: 'player_left', playerId }));
  }
}

export default app;
