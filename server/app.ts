// server/app.ts
import { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { serialize } from './协议';
import {
  创建房间,
  加入房间,
  离开房间,
  设置准备,
  所有人准备,
  获取房间,
  获取房间列表,
  根据玩家ID查找房间,
  广播消息,
} from './房间';
import { GameSession } from './会话';

const app = new Hono();

// 游戏会话管理
const 游戏会话 = new Map<string, GameSession>();

// 玩家到房间的映射
const 玩家房间映射 = new Map<string, string>();

// REST API
app.get('/api/rooms', (c) => {
  return c.json(获取房间列表());
});

app.get('/api/rooms/:id', (c) => {
  const id = c.req.param('id');
  const room = 获取房间(id);
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
  message: import('./协议').ClientMessage,
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
      ws.send(serialize({ type: 'room_list', rooms: 获取房间列表() }));
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
  const existingRoom = 根据玩家ID查找房间(playerId);
  if (existingRoom) {
    离开房间(existingRoom.id, playerId);
    玩家房间映射.delete(playerId);
  }

  const room = 创建房间(name, maxPlayers, playerId, ws);
  玩家房间映射.set(playerId, room.id);

  ws.send(serialize({
    type: 'room_joined',
    roomId: room.id,
    playerId,
  }));
}

function handleJoinRoom(playerId: string, roomId: string, ws: WSContext): void {
  const existingRoom = 根据玩家ID查找房间(playerId);
  if (existingRoom) {
    离开房间(existingRoom.id, playerId);
    玩家房间映射.delete(playerId);
  }

  const room = 加入房间(roomId, playerId, ws);
  if (!room) {
    ws.send(serialize({ type: 'error', message: '无法加入房间' }));
    return;
  }

  玩家房间映射.set(playerId, roomId);

  ws.send(serialize({
    type: 'room_joined',
    roomId,
    playerId,
  }));

  广播消息(
    room,
    serialize({ type: 'player_joined', playerId }),
    playerId,
  );
}

function handleReady(playerId: string): void {
  const roomId = 玩家房间映射.get(playerId);
  if (!roomId) return;
  设置准备(roomId, playerId);
}

function handleStartGame(playerId: string): void {
  const roomId = 玩家房间映射.get(playerId);
  if (!roomId) return;

  const room = 获取房间(roomId);
  if (!room) return;

  if (room.hostId !== playerId) {
    const ws = room.players.get(playerId);
    if (ws) ws.send(serialize({ type: 'error', message: '只有房主可以开始游戏' }));
    return;
  }

  if (!所有人准备(roomId)) {
    const ws = room.players.get(playerId);
    if (ws) ws.send(serialize({ type: 'error', message: '还有玩家未准备' }));
    return;
  }

  const session = new GameSession(room);
  游戏会话.set(roomId, session);

  if (session.startGame()) {
    广播消息(room, serialize({ type: 'game_started' }));
  }
}

function handleAction(playerId: string, action: import('../shared/types').PlayerAction): void {
  const roomId = 玩家房间映射.get(playerId);
  if (!roomId) return;

  const session = 游戏会话.get(roomId);
  if (!session) return;

  session.handleAction(playerId, action);
}

function handleResponse(playerId: string, promptId: string, choice: unknown): void {
  console.warn(`玩家 ${playerId} 响应 ${promptId}:`, choice);
}

function handleLeaveRoom(playerId: string): void {
  const roomId = 玩家房间映射.get(playerId);
  if (!roomId) return;

  const room = 离开房间(roomId, playerId);
  玩家房间映射.delete(playerId);

  if (room) {
    广播消息(room, serialize({ type: 'player_left', playerId }));
  }

  游戏会话.delete(roomId);
}

function handleDisconnect(playerId: string): void {
  const roomId = 玩家房间映射.get(playerId);
  if (!roomId) return;

  const session = 游戏会话.get(roomId);
  if (session) {
    session.handleDisconnect(playerId);
    游戏会话.delete(roomId);
  }

  const room = 离开房间(roomId, playerId);
  玩家房间映射.delete(playerId);

  if (room) {
    广播消息(room, serialize({ type: 'player_left', playerId }));
  }
}

export default app;
