// server/ws.ts — WebSocket 消息处理。
// 从 app.ts 抽离:handleWsMessage/Open/Close 入口 + 房间/会话操作 handler + 广播辅助。
// 共享状态(gameSessions/playerRoomMap)从 registry 导入。

import type { WSContext } from 'hono/ws';
import { serialize, normalizeRoomConfig } from './protocol';
import type { RoomConfig } from './protocol';
import {
  createRoom,
  createDebugRoom,
  joinRoom,
  joinDebugRoom,
  leaveRoom,
  setReady,
  allReady,
  getRoom,
  findRoomByPlayerId,
  broadcastMessage,
  updateConfig,
  type Room,
} from './room';
import { GameSession } from './session';
import { gameSessions, playerRoomMap } from './registry';
import { createLogger } from './logger';

const log = createLogger('ws');

/** 广播房间准备状态(room_state)给房间内所有连接。
 *  调试房间配置阶段:玩家加入/离开/准备/配置更新时触发。 */
function broadcastRoomState(room: Room): void {
  broadcastMessage(
    room,
    serialize({
      type: 'room_state',
      readyPlayers: [...room.readyPlayers],
      playerIds: [...room.players.keys()],
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      config: room.config,
    }),
  );
}

/** 广播房间配置变更(room_config)。 */
function broadcastRoomConfig(room: Room): void {
  broadcastMessage(room, serialize({ type: 'room_config', config: room.config }));
}

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
      void handleStartGame(playerId).catch((err) => {
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
      void handleJoinDebugRoom(playerId, message.roomId, message.lastSeq ?? 0, ws).catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        log.error('handleJoinDebugRoom failed', {
          playerId,
          roomId: message.roomId,
          error: e.stack ?? String(e),
        });
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

  ws.send(
    serialize({
      type: 'room_joined',
      roomId: room.id,
      playerId,
    }),
  );
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

  ws.send(
    serialize({
      type: 'room_joined',
      roomId,
      playerId,
    }),
  );

  broadcastMessage(room, serialize({ type: 'player_joined', playerId }), playerId);
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
  let session = room.isDebug ? (gameSessions.get(roomId) ?? undefined) : undefined;
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
 *  任意座次/玩家可触发(debug 一人多座 / 多人各自连接);复用同一 session,
 *  重置后由玩家重新准备 → start_game。resetToLobby 幂等,重复触发无害。 */
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

  void session.handleAction(playerId, action).catch((err) => {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error('session.handleAction failed', { playerId, error: e.stack ?? String(e) });
  });
}

function handleReorderHand(playerId: string, order: string[]): void {
  const roomId = playerRoomMap.get(playerId);
  if (!roomId) return;

  const session = gameSessions.get(roomId);
  if (!session) return;

  void session.handleReorderHand(playerId, order).catch((err) => {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error('session.handleReorderHand failed', { playerId, error: e.stack ?? String(e) });
  });
}

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
    void session.destroy().catch((err) => {
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

async function handleJoinDebugRoom(
  playerId: string,
  roomId: string,
  lastSeq: number,
  ws: WSContext,
): Promise<void> {
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

function handleReconnect(
  currentPlayerId: string,
  previousPlayerId: string,
  lastSeq: number,
  ws: WSContext,
): void {
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
