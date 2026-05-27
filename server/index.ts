// server/index.ts
import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import { serve } from '@hono/node-server';
import type { WSContext } from 'hono/ws';
import { deserialize, serialize } from './协议';
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
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// 游戏会话管理
const 游戏会话 = new Map<string, GameSession>();

// 玩家ID生成
let 玩家计数 = 0;
function 生成玩家ID(): string {
  玩家计数++;
  return `player_${玩家计数}_${Date.now()}`;
}

// 玩家到房间的映射
const 玩家房间映射 = new Map<string, string>();

// REST API
app.post('/api/rooms', async (c) => {
  const body = await c.req.json<{ name?: string; maxPlayers?: number }>();
  const _name = body.name ?? '新房间';
  const _maxPlayers = body.maxPlayers ?? 2;
  const hostId = 生成玩家号();

  // 这里需要WebSocket连接才能创建房间，所以实际创建在WebSocket连接时进行
  return c.json({ hostId, message: '请通过WebSocket连接创建房间' });
});

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

// WebSocket端点
app.get(
  '/ws',
  upgradeWebSocket((_c) => {
    let 当前玩家ID: string | null = null;

    return {
      onOpen(_event, _ws) {
        当前玩家ID = 生成玩家ID();
        console.warn(`玩家 ${当前玩家ID} 已连接`);
      },

      onMessage(event, ws) {
        if (typeof event.data !== 'string') return;

        const message = deserialize(event.data);
        if (!message) {
          ws.send(serialize({ type: 'error', message: '无效的消息格式' }));
          return;
        }

        if (!当前玩家ID) {
          ws.send(serialize({ type: 'error', message: '未初始化' }));
          return;
        }

        handleMessage(当前玩家ID, message, ws);
      },

      onClose(_event, _ws) {
        if (当前玩家ID) {
          console.warn(`玩家 ${当前玩家ID} 已断开`);
          handleDisconnect(当前玩家ID);
        }
      },
    };
  }),
);

function handleMessage(
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

function handleCreateRoom(
  playerId: string,
  name: string,
  maxPlayers: number,
  ws: WSContext,
): void {
  // 如果玩家已在房间中，先离开
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
  // 如果玩家已在房间中，先离开
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

  // 通知房间内其他玩家
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

  // 只有房主可以开始游戏
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

function handleAction(playerId: string, action: import('../shared/类型').PlayerAction): void {
  const roomId = 玩家房间映射.get(playerId);
  if (!roomId) return;

  const session = 游戏会话.get(roomId);
  if (!session) return;

  session.handleAction(playerId, action);
}

function handleResponse(playerId: string, promptId: string, choice: unknown): void {
  // 简化实现
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

  // 清理游戏会话
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

function 生成玩家号(): string {
  玩家计数++;
  return `player_${玩家计数}_${Date.now()}`;
}

// 启动服务器
const port = parseInt(process.env.PORT ?? '3001');
const server = serve({ fetch: app.fetch, port });
injectWebSocket(server);

console.warn(`服务器运行在 http://localhost:${port}`);
console.warn(`WebSocket端点: ws://localhost:${port}/ws`);
