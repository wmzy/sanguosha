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
} from './room';
import { deletePersistedRoom } from './persistence';
import {
  createSnapshot,
  patchSnapshotDescription,
  type CreateSnapshotRequest,
} from './snapshot';
import { normalizeRoomConfig } from './protocol';
import { GameSession } from './session';
import { gameSessions, playerRoomMap } from './registry';
import { createLogger } from './logger';

const log = createLogger('rest');

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
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name =
      (typeof raw.name === 'string' ? raw.name.trim() : '') || `房间${Date.now().toString(36)}`;
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
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
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
}
