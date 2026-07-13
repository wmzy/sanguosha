// server/rest.ts — REST API 路由。
// 从 app.ts 抽离:rooms/debug-room/snapshot 等资源路由集中定义。
// 通过 applyRestRoutes(app) 注册到主 app 实例(与原先直接 app.get/post 行为完全一致,
// 主 app 上的 cors/requestLogger/rateLimit/errorHandler 中间件照常生效)。

import type { Hono } from 'hono';
import {
  createRoom,
  createDebugRoom,
  getRoom,
  getRoomList,
  deleteRoom,
  leaveRoom,
  joinRoom,
  joinDebugRoom,
  setReady,
  unsetReady,
  allReady,
  findRoomByPlayerId,
  broadcastMessage,
  updateConfig,
  joinAsSpectator,
  removeSpectator,
  switchRole,
  requestView,
  approveView,
  rejectView,
  revokeView,
  addChatMessage,
  resetChatUsage,
  getChatHistory,
  type Room,
} from './room';
import { deletePersistedRoom } from './persistence';
import { deleteRoomFromDb } from './roomStore';
import {
  createSnapshot,
  patchSnapshotDescription,
  type CreateSnapshotRequest,
} from './snapshot';
import { normalizeRoomConfig } from './protocol';
import type { RoomConfig } from './protocol';
import { GameSession } from './session';
import { gameSessions, playerRoomMap } from './registry';
import { createLogger } from './logger';
import type { ConnectionSink } from './connection';
import { generatePlayerId } from './utils';
import { sseStreamHandler } from './sse';

const log = createLogger('rest');

/** 广播 room_state 给房间内所有连接。 */
function broadcastRoomState(room: Room): void {
  broadcastMessage(room, {
    type: 'room_state',
    readyPlayers: [...room.readyPlayers],
    playerIds: [...room.players.keys()],
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    config: room.config,
    spectatorIds: [...room.spectators.keys()],
    viewGrants: Object.fromEntries(room.viewGrants),
    pendingViewRequests: Object.fromEntries(room.pendingViewRequests),
    roomType: room.roomType,
  });
}

/** 创建 null sink（REST 入口无活跃连接时占位）。 */
function nullSink(): ConnectionSink {
  return { send: () => {}, close: () => {}, isAlive: false };
}

/** 将所有 REST 路由注册到指定 app 实例。 */
export function applyRestRoutes(app: Hono): void {
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

    // 清理内存中的 session/room（如果存在）
    const session = gameSessions.get(id);
    if (session) {
      await session.destroy();
      gameSessions.delete(id);
    }
    if (room) {
      const playerIds = [...room.players.keys()];
      for (const pid of playerIds) {
        playerRoomMap.delete(pid);
        leaveRoom(id, pid);
      }
      deleteRoom(id);
    }

    // 无论 room 是否在内存中（如重启后内存丢失但磁盘还在），都必须删持久化文件。
    // 此前 !room 时 early return 404 跳过此处，导致重启后房间复活。
    await deletePersistedRoom(id);
    // 普通房间: 还需从 DB 删除元数据记录。
    await deleteRoomFromDb(id);

    return c.json({ success: true });
  });

  app.post('/api/rooms', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name =
      (typeof raw.name === 'string' ? raw.name.trim() : '') || `房间${Date.now().toString(36)}`;
    const maxPlayers = typeof raw.maxPlayers === 'number' ? raw.maxPlayers : 2;
    if (maxPlayers < 2 || maxPlayers > 8) {
      return c.json({ error: '最大玩家数须在2-8之间' }, 400);
    }
    const config = raw.config ? normalizeRoomConfig(raw.config) : undefined;
    const roomType: 'normal' | 'quick' =
      raw.roomType === 'normal' ? 'normal' : 'quick';

    try {
      const playerId = typeof raw.playerId === 'string' && raw.playerId.trim()
        ? raw.playerId.trim()
        : generatePlayerId();
      const room = createRoom(name, maxPlayers, playerId, nullSink(), config, roomType);
      playerRoomMap.set(playerId, room.id);
      return c.json({ roomId: room.id, playerId });
    } catch (err) {
      log.error('创建房间失败', { error: String(err) });
      return c.json({ error: `创建房间失败: ${String(err)}` }, 500);
    }
  });

  app.post('/api/rooms/:id/join', async (c) => {
    const id = c.req.param('id');
    const room = getRoom(id);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    if (room.isDebug) return c.json({ error: '调试房间请使用调试入口' }, 400);

    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' && raw.playerId.trim()
      ? raw.playerId.trim()
      : generatePlayerId();

    // 已在房间中的玩家重新加入（刷新页面/重连 SSE）:直接返回成功
    if (room.players.has(playerId)) {
      return c.json({ roomId: id, playerId });
    }

    if (room.players.size >= room.maxPlayers) return c.json({ error: '房间已满' }, 400);
    if (room.status !== '等待中') return c.json({ error: '游戏已开始' }, 400);

    // 清理旧房间关联
    const existingRoom = findRoomByPlayerId(playerId);
    if (existingRoom) {
      leaveRoom(existingRoom.id, playerId);
      playerRoomMap.delete(playerId);
    }

    // 加入房间（null sink 占位，SSE 连接时替换）
    const joined = joinRoom(id, playerId, nullSink());
    if (!joined) return c.json({ error: '加入失败' }, 400);
    playerRoomMap.set(playerId, id);

    broadcastMessage(room, { type: 'player_joined', playerId }, playerId);
    broadcastRoomState(room);

    return c.json({ roomId: id, playerId });
  });

  app.post('/api/debug-room', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerCount = typeof raw.playerCount === 'number' ? raw.playerCount : 5;
    if (playerCount < 2 || playerCount > 8) {
      return c.json({ error: '玩家人数须在2-8之间' }, 400);
    }

    try {
      const config = normalizeRoomConfig(raw.config);
      const room = createDebugRoom(config.name || `调试${playerCount}人`, playerCount, config);

      // 创建占位 session(不 startGame)
      const session = new GameSession(room, true);
      gameSessions.set(room.id, session);

      // 可选:创建者自动加入第一个座次（默认 false，由 SSE/WS 连接负责加入）
      let playerId: string | undefined;
      let seatIndex: number | undefined;
      if (raw.autoJoin === true) {
        playerId = typeof raw.playerId === 'string' && raw.playerId.trim()
          ? raw.playerId.trim()
          : generatePlayerId();
        joinDebugRoom(room.id, playerId, nullSink());
        playerRoomMap.set(playerId, room.id);
        seatIndex = session.assignDebugSeat(playerId);
      }

      return c.json({
        roomId: room.id,
        ...(playerId ? { playerId, seatIndex } : {}),
      });
    } catch (err) {
      log.error('创建调试房间失败', { error: String(err) });
      return c.json({ error: `创建调试房间失败: ${String(err)}` }, 500);
    }
  });

  // ── SSE 事件流 ──
  // GET /api/rooms/:id/stream?playerId=xxx — 建立 SSE 连接接收推送
  app.get('/api/rooms/:id/stream', (c) => sseStreamHandler(c));

  // ── 游戏操作路由（替代 WS C→S 消息） ──

  // POST /api/debug-room/:id/join — 加入调试房间
  app.post('/api/debug-room/:id/join', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room?.isDebug) return c.json({ error: '房间不存在或不是调试房间' }, 404);

    const session = gameSessions.get(roomId);
    if (!session) return c.json({ error: '游戏会话不存在' }, 404);

    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' && raw.playerId.trim()
      ? raw.playerId.trim()
      : generatePlayerId();
    // 清理旧房间关联
    const existingRoom = findRoomByPlayerId(playerId);
    if (existingRoom) {
      leaveRoom(existingRoom.id, playerId);
      playerRoomMap.delete(playerId);
    }

    const joined = joinDebugRoom(roomId, playerId, nullSink());
    if (!joined) return c.json({ error: '加入调试房间失败' }, 400);
    playerRoomMap.set(playerId, roomId);

    // 刷新重连复用座次
    if (joined.replacedPlayerId) {
      session.evictDebugPlayer(joined.replacedPlayerId);
      playerRoomMap.delete(joined.replacedPlayerId);
    }

    const seatIndex = session.assignDebugSeat(playerId);

    if (room.status === '进行中') {
      // 游戏已开始(刷新重连):SSE 连接时由 sseStreamHandler 调 reconnectPlayer 恢复视图
      // 此处仅返回 room_joined 信息
    } else {
      broadcastRoomState(room);
    }

    return c.json({ roomId, playerId, seatIndex });
  });

  // POST /api/rooms/:id/ready — 玩家准备
  app.post('/api/rooms/:id/ready', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
    if (!playerId) return c.json({ error: '缺少 playerId' }, 400);

    const ok = setReady(roomId, playerId);
    if (!ok) return c.json({ error: '准备失败' }, 400);

    const room = getRoom(roomId);
    if (room) {
      broadcastMessage(room, { type: 'player_ready', playerId });
      broadcastRoomState(room);
    }
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/cancel-ready — 玩家取消准备
  app.post('/api/rooms/:id/cancel-ready', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
    if (!playerId) return c.json({ error: '缺少 playerId' }, 400);

    unsetReady(roomId, playerId);

    const room = getRoom(roomId);
    if (room) {
      broadcastRoomState(room);
    }
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/start — 开始游戏
  app.post('/api/rooms/:id/start', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' ? raw.playerId : '';

    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);

    // debug 房间任意座次可触发;普通房间仅房主
    if (!room.isDebug && room.hostId !== playerId) {
      return c.json({ error: '只有房主可以开始游戏' }, 403);
    }
    // debug 房间跳过 allReady 检查（单人控制所有座次）
    if (!room.isDebug && !allReady(roomId)) {
      return c.json({ error: '还有玩家未准备' }, 400);
    }

    let session = room.isDebug ? (gameSessions.get(roomId) ?? undefined) : undefined;
    if (!session) {
      session = new GameSession(room, room.isDebug === true);
      gameSessions.set(roomId, session);
    }

    const count = room.isDebug ? room.maxPlayers : undefined;
    if (await session.startGame(count)) {
      resetChatUsage(room.id);
      broadcastMessage(room, { type: 'game_started' });
    }
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/restart — 再来一局
  app.post('/api/rooms/:id/restart', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    const session = gameSessions.get(roomId);
    if (!session) return c.json({ error: '游戏会话不存在' }, 404);

    session.resetToLobby();
    resetChatUsage(roomId);
    broadcastRoomState(room);
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/action — 提交玩家操作
  app.post('/api/rooms/:id/action', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
    const action = raw.action;
    if (!playerId || !action) return c.json({ error: '缺少 playerId 或 action' }, 400);

    const session = gameSessions.get(roomId);
    if (!session) return c.json({ error: '游戏会话不存在' }, 404);

    // session.handleAction 内部处理 reject（通过 SSE 推 actionRejected）
    await session.handleAction(playerId, action as never);
    return c.json({ accepted: true });
  });

  // POST /api/rooms/:id/reorder — 重排手牌
  app.post('/api/rooms/:id/reorder', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
    const order = raw.order;
    if (!playerId || !Array.isArray(order)) return c.json({ error: '缺少参数' }, 400);

    const session = gameSessions.get(roomId);
    if (!session) return c.json({ error: '游戏会话不存在' }, 404);

    await session.handleReorderHand(playerId, order as string[]);
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/chat — 发送聊天消息
  app.post('/api/rooms/:id/chat', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
    const text = typeof raw.text === 'string' ? raw.text : '';
    if (!playerId) return c.json({ error: '缺少 playerId' }, 400);

    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    if (!room.players.has(playerId)) return c.json({ error: '不在房间中' }, 403);

    const result = addChatMessage(roomId, playerId, text);
    if (!result.ok) return c.json({ error: result.error }, 400);

    // 广播给房间内所有连接
    const playerIds = [...room.players.keys()];
    const seatIndex = playerIds.indexOf(playerId);
    broadcastMessage(room, {
      type: 'chat',
      playerId,
      seatIndex,
      text: text.trim(),
      timestamp: Date.now(),
    });

    return c.json({ success: true, remaining: result.remaining });
  });

  // GET /api/rooms/:id/chat/history — 获取聊天历史（调试用）
  app.get('/api/rooms/:id/chat/history', (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    return c.json(getChatHistory(roomId));
  });

  // POST /api/rooms/:id/leave — 离开房间
  app.post('/api/rooms/:id/leave', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
    if (!playerId) return c.json({ error: '缺少 playerId' }, 400);

    const roomBefore = getRoom(roomId);
    const isNormal = roomBefore?.roomType === 'normal';

    const leftRoom = leaveRoom(roomId, playerId);
    playerRoomMap.delete(playerId);

    if (leftRoom) {
      broadcastMessage(leftRoom, { type: 'player_left', playerId });
    }

    // 快速房间: leaveRoom 返回 null(全员离开+无游戏)时清理 session + 持久化;
    // 普通房间: 不自动销毁, 保留 session 和游戏状态。
    if (!isNormal && !leftRoom) {
      const session = gameSessions.get(roomId);
      if (session) {
        void session.destroy().catch((err) => {
          const e = err instanceof Error ? err : new Error(String(err));
          log.error('session.destroy failed', { roomId, error: e.stack ?? String(e) });
        });
        gameSessions.delete(roomId);
      }
      void deletePersistedRoom(roomId).catch(() => {});
    }
    return c.json({ success: true });
  });

  // PUT /api/rooms/:id/config — 更新房间配置
  app.put('/api/rooms/:id/config', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
    const config = raw.config as RoomConfig | undefined;
    if (!playerId || !config) return c.json({ error: '缺少参数' }, 400);

    const maxPlayers = typeof raw.maxPlayers === 'number' ? raw.maxPlayers : undefined;
    const updated = updateConfig(roomId, config, playerId, maxPlayers);
    if (!updated) return c.json({ error: '无法更新配置' }, 400);

    const room = getRoom(roomId);
    if (room) {
      broadcastMessage(room, { type: 'room_config', config: room.config });
      broadcastRoomState(room);
    }
    return c.json({ config: updated });
  });

  // Debug 快照:保存前后端完整游戏状态到 data/snapshots/
  app.post('/api/snapshot', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!body || typeof body.roomId !== 'string') {
      return c.json({ error: '缺少 roomId' }, 400);
    }
    if (
      typeof body.perspective !== 'number' ||
      typeof body.frontendSeqs !== 'object' ||
      body.frontendSeqs === null ||
      typeof body.frontendViews !== 'object' ||
      body.frontendViews === null
    ) {
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
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!body || typeof body.description !== 'string') {
      return c.json({ error: '缺少 description' }, 400);
    }
    const result = await patchSnapshotDescription(snapshotId, body.description);
    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.json(result);
  });

  // ── 旁观者路由 ──

  // POST /api/rooms/:id/join-spectator — 以旁观者身份加入房间
  app.post('/api/rooms/:id/join-spectator', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);

    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const spectatorId =
      typeof raw.playerId === 'string' && raw.playerId.trim()
        ? raw.playerId.trim()
        : generatePlayerId();

    // 清理旧房间关联
    const existingRoom = findRoomByPlayerId(spectatorId);
    if (existingRoom) {
      if (existingRoom.spectators.has(spectatorId)) {
        removeSpectator(existingRoom.id, spectatorId);
      } else {
        leaveRoom(existingRoom.id, spectatorId);
      }
      playerRoomMap.delete(spectatorId);
    }

    const joined = joinAsSpectator(roomId, spectatorId, nullSink());
    if (!joined) return c.json({ error: '加入失败' }, 400);
    playerRoomMap.set(spectatorId, roomId);

    broadcastMessage(room, { type: 'spectator_joined', spectatorId: spectatorId });
    broadcastRoomState(room);

    return c.json({ roomId, playerId: spectatorId });
  });

  // POST /api/rooms/:id/switch-role — 切换玩家身份（等待中）
  app.post('/api/rooms/:id/switch-role', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
    const newRole = raw.role === 'spectator' ? 'spectator' : raw.role === 'player' ? 'player' : '';
    if (!playerId || !newRole) return c.json({ error: '缺少 playerId 或 role' }, 400);

    const result = switchRole(roomId, playerId, newRole);
    if (!result.room) return c.json({ error: '房间不存在' }, 404);
    if (!result.success) return c.json({ error: '切换失败（仅等待中允许，或房间已满）' }, 400);

    broadcastMessage(result.room, { type: 'role_changed', playerId, newRole });
    broadcastRoomState(result.room);
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/request-view — 旁观者申请查看指定座次
  app.post('/api/rooms/:id/request-view', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const spectatorId = typeof raw.spectatorId === 'string' ? raw.spectatorId : '';
    const targetSeat = typeof raw.targetSeat === 'number' ? raw.targetSeat : -1;
    if (!spectatorId || targetSeat < 0) return c.json({ error: '缺少参数' }, 400);

    const room = requestView(roomId, spectatorId, targetSeat);
    if (!room) return c.json({ error: '申请失败' }, 400);

    // 广播给所有连接（目标座次玩家会收到）
    broadcastMessage(room, { type: 'view_request', spectatorId, targetSeat });
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/approve-view — 玩家审批通过
  app.post('/api/rooms/:id/approve-view', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const spectatorId = typeof raw.spectatorId === 'string' ? raw.spectatorId : '';
    const targetSeat = typeof raw.targetSeat === 'number' ? raw.targetSeat : -1;
    if (!spectatorId || targetSeat < 0) return c.json({ error: '缺少参数' }, 400);

    const room = approveView(roomId, spectatorId, targetSeat);
    if (!room) return c.json({ error: '审批失败' }, 400);

    // 清除旁观者 baseline，强制重发新 viewer 的 initialView
    const session = gameSessions.get(roomId);
    if (session) {
      session.clearSpectatorBaseline(spectatorId);
    }

    broadcastMessage(room, { type: 'view_granted', spectatorId, seatIndex: targetSeat });
    broadcastRoomState(room);

    // 如果游戏进行中，立即发送新视图
    if (session && room.status === '进行中') {
      session.sendSpectatorInitialView(spectatorId);
    }

    return c.json({ success: true });
  });

  // POST /api/rooms/:id/reject-view — 玩家拒绝申请
  app.post('/api/rooms/:id/reject-view', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const spectatorId = typeof raw.spectatorId === 'string' ? raw.spectatorId : '';
    if (!spectatorId) return c.json({ error: '缺少 spectatorId' }, 400);

    const room = rejectView(roomId, spectatorId);
    if (!room) return c.json({ error: '操作失败' }, 400);

    broadcastRoomState(room);
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/revoke-view — 玩家撤销已授权
  app.post('/api/rooms/:id/revoke-view', async (c) => {
    const roomId = c.req.param('id');
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const spectatorId = typeof raw.spectatorId === 'string' ? raw.spectatorId : '';
    if (!spectatorId) return c.json({ error: '缺少 spectatorId' }, 400);

    const room = revokeView(roomId, spectatorId);
    if (!room) return c.json({ error: '操作失败' }, 400);

    // 清除旁观者 baseline，强制重发公开视图
    const session = gameSessions.get(roomId);
    if (session) {
      session.clearSpectatorBaseline(spectatorId);
    }

    broadcastMessage(room, { type: 'view_revoked', spectatorId });
    broadcastRoomState(room);

    // 如果游戏进行中，立即发送公开视图
    if (session && room.status === '进行中') {
      session.sendSpectatorInitialView(spectatorId);
    }

    return c.json({ success: true });
  });
}
