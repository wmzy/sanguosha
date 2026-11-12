// server/routes/room-routes.ts — 房间生命周期/成员管理路由(自 rest.ts 拆出)。
// 路由路径/方法/校验顺序/响应形状与拆分前完全一致。

import type { Hono } from 'hono';
import {
  createRoom,
  createDebugRoom,
  getRoom,
  getRoomList,
  leaveRoom,
  joinRoom,
  joinDebugRoom,
  broadcastMessage,
  updateConfig,
  kickPlayer,
  checkRoomPassword,
  notifyRoomChanged,
} from '../room';
import { destroyRoomCompletely } from '../teardown';
import { hashPassword } from '../auth/password';
import { requireUser } from '../auth/guard';
import { normalizeRoomConfig, type RoomConfig } from '../protocol';
import { GameSession } from '../session';
import { gameSessions, playerRoomMap } from '../registry';
import { createLogger } from '../logger';
import { generatePlayerId } from '../utils';
import { sseStreamHandler } from '../sse';
import {
  authRequired,
  broadcastRoomState,
  detachFromOtherRooms,
  nullSink,
  optString,
  readJsonBody,
  requireHost,
  requireSessionHost,
  resolveActorOr401,
  resolvePlayerOrRespond,
} from './helpers';

const log = createLogger('rest');

/** 注册房间生命周期/成员管理路由。 */
export function applyRoomRoutes(app: Hono): void {
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

  // ── SSE 事件流 ──
  // GET /api/rooms/:id/stream?playerId=xxx — 建立 SSE 连接接收推送
  app.get('/api/rooms/:id/stream', (c) => sseStreamHandler(c));

  app.delete('/api/rooms/:id', async (c) => {
    const id = c.req.param('id');
    // 非调试房间仅房主可删(会话 userId === hostId);调试房保持开放(调试工作流),
    // 房间已不在内存时保持幂等清理(重启后磁盘/DB 孤儿数据,无权限可泄露)。
    const room = getRoom(id);
    const forbidden = await requireSessionHost(c, room, '只有房主可以删除房间');
    if (forbidden) return forbidden;
    // 统一走 destroyRoomCompletely:幂等清理 session + room + .json + DB,
    // 无论 room 是否在内存中(如重启后内存丢失但磁盘/DB 还在)。
    await destroyRoomCompletely(id);
    return c.json({ success: true });
  });

  app.post('/api/rooms', async (c) => {
    const raw = await readJsonBody(c);
    const name =
      (typeof raw.name === 'string' ? raw.name.trim() : '') || `房间${Date.now().toString(36)}`;
    const maxPlayers = typeof raw.maxPlayers === 'number' ? raw.maxPlayers : 2;
    if (maxPlayers < 2 || maxPlayers > 8) {
      return c.json({ error: '最大玩家数须在2-8之间' }, 400);
    }
    const config = raw.config ? normalizeRoomConfig(raw.config) : undefined;
    const roomType: 'normal' | 'quick' =
      raw.roomType === 'normal' ? 'normal' : 'quick';
    // 进房密码:可选,1-32 位;服务端只存 scrypt 哈希
    const rawPassword = typeof raw.password === 'string' ? raw.password : '';
    if (rawPassword.length > 32) {
      return c.json({ error: '房间密码长度不能超过 32 位' }, 400);
    }
    const passwordHash = rawPassword ? await hashPassword(rawPassword) : null;

    // 普通房间必须登录:playerId = 稳定 userId,显示名 = displayName
    const user = await requireUser(c);
    if (!user) return authRequired(c);

    try {
      const room = createRoom(
        name,
        maxPlayers,
        user.id,
        nullSink(),
        config,
        roomType,
        passwordHash,
        user.displayName,
      );
      playerRoomMap.set(user.id, room.id);
      return c.json({ roomId: room.id, playerId: user.id, playerName: user.displayName });
    } catch (err) {
      log.error('创建房间失败', { error: String(err) });
      return c.json({ error: `创建房间失败: ${String(err)}` }, 500);
    }
  });

  app.post('/api/rooms/:id/join', async (c) => {
    const id = c.req.param('id');
    const room = getRoom(id);

    const raw = await readJsonBody(c);

    // 普通房间必须登录(先于房间存在性检查:鉴权语义优先);playerId 一律取会话 userId
    const user = await requireUser(c);
    if (!user) return authRequired(c);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    if (room.isDebug) return c.json({ error: '调试房间请使用调试入口' }, 400);
    const playerId = user.id;

    // 已在房间中的玩家重新加入（刷新页面/重连 SSE）:直接返回成功
    if (room.players.has(playerId)) {
      return c.json({ roomId: id, playerId, playerName: user.displayName });
    }

    // 断线重连：玩家已在 seats 中但 SSE 断开，允许在任何状态下重连（含游戏进行中）
    // SSE handler 会直接设置 room.players 并调用 reconnectPlayer 恢复游戏视图
    if (room.seats.includes(playerId)) {
      playerRoomMap.set(playerId, id);
      return c.json({ roomId: id, playerId, playerName: user.displayName });
    }

    // 新玩家加入：游戏进行中不允许（「已结束」允许——上一局打完等房主重置,
    // 此时退出房间的玩家可重新加入空座,旁观者也可入座）
    if (room.status !== '等待中' && room.status !== '已结束')
      return c.json({ error: '游戏已开始' }, 400);

    // 有密码房间:验证进房密码(成员重连/已在房间已在上方豁免)
    if (room.passwordHash) {
      const password = typeof raw.password === 'string' ? raw.password : '';
      const ok = await checkRoomPassword(room, password);
      if (!ok) return c.json({ error: '房间密码错误', code: 'ROOM_PASSWORD_REQUIRED' }, 403);
    }

    if (room.players.size >= room.maxPlayers) return c.json({ error: '房间已满' }, 400);

    // 清理旧房间关联（跨房间切换时离开旧房间;同房重连不清理）
    detachFromOtherRooms(playerId, id);

    // 加入房间（null sink 占位，SSE 连接时替换）
    const joined = joinRoom(id, playerId, nullSink(), user.displayName);
    if (!joined) return c.json({ error: '加入失败' }, 400);
    playerRoomMap.set(playerId, id);

    broadcastMessage(room, { type: 'player_joined', playerId }, playerId);
    broadcastRoomState(room);

    return c.json({ roomId: id, playerId, playerName: user.displayName });
  });

  app.post('/api/debug-room', async (c) => {
    const raw = await readJsonBody(c);
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

  // POST /api/debug-room/:id/join — 加入调试房间
  app.post('/api/debug-room/:id/join', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room?.isDebug) return c.json({ error: '房间不存在或不是调试房间' }, 404);

    const session = gameSessions.get(roomId);
    if (!session) return c.json({ error: '游戏会话不存在' }, 404);

    const raw = await readJsonBody(c);
    const playerId = typeof raw.playerId === 'string' && raw.playerId.trim()
      ? raw.playerId.trim()
      : generatePlayerId();
    // 清理旧房间关联(调试房重进连本房残留一并清理,靠 joinDebugRoom 重新占座)
    detachFromOtherRooms(playerId);

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

  // POST /api/rooms/:id/leave — 离开房间
  app.post('/api/rooms/:id/leave', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    // 非调试房间:登录用户只能离开自己的座位(忽略伪造的 playerId)。
    // 房间不存在时同样要求登录(getRoom()?.isDebug 对 null 房为 undefined → 鉴权)。
    const actor = await resolveActorOr401(c, getRoom(roomId)?.isDebug !== true, optString(raw.playerId));
    if (actor.response) return actor.response;
    const playerId = actor.playerId;
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
      void destroyRoomCompletely(roomId);
    }
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/kick — 房主踢出玩家（仅等待中）
  app.post('/api/rooms/:id/kick', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    const targetPlayerId = typeof raw.targetPlayerId === 'string' ? raw.targetPlayerId : '';
    if (!targetPlayerId) return c.json({ error: '缺少参数' }, 400);

    // 非调试房间:房主身份由会话决定(登录用户 id 必须 === room.hostId)
    const room0 = getRoom(roomId);
    const actor = await resolveActorOr401(c, !!room0 && !room0.isDebug, optString(raw.playerId));
    if (actor.response) return actor.response;
    const playerId = actor.playerId;
    if (!playerId || !targetPlayerId) return c.json({ error: '缺少参数' }, 400);

    const result = kickPlayer(roomId, playerId, targetPlayerId);
    if (!result) {
      return c.json({ error: '无法踢出该玩家（仅房主可操作，或目标不在房间中）' }, 400);
    }

    // 先通知被踢玩家（让其显示「被移出」而非触发自动重连），再关闭其连接
    if (result.kickedSink) {
      result.kickedSink.send({ type: 'player_kicked', playerId: targetPlayerId, hostId: playerId });
      try {
        result.kickedSink.close();
      } catch {
        /* */
      }
    }
    playerRoomMap.delete(targetPlayerId);

    // 广播给其余成员：等同离开 + 更新房间状态
    broadcastMessage(result.room, { type: 'player_left', playerId: targetPlayerId });
    broadcastRoomState(result.room);
    return c.json({ success: true });
  });

  // PUT /api/rooms/:id/config — 更新房间配置
  // 非调试房间:身份取会话 userId。updateConfig 内部按 hostId 校验,
  // body.playerId 可伪造房主 id 绕过 → 必须在 REST 层覆盖。
  app.put('/api/rooms/:id/config', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    const config = raw.config as RoomConfig | undefined;
    if (!config) return c.json({ error: '缺少 config' }, 400);
    const resolved = await resolvePlayerOrRespond(c, roomId, optString(raw.playerId));
    if (resolved.response) return resolved.response;
    const playerId = resolved.playerId;

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

  // PUT /api/rooms/:id/password — 房主设置/修改/清除房间密码(仅等待中)
  // body: { playerId, password?: string }。password 为空/缺省 = 清除密码。
  // 修改后已入房成员不受影响,仅约束后续加入者。
  app.put('/api/rooms/:id/password', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);

    const raw = await readJsonBody(c);
    // 非调试房间:房主身份由会话决定
    const actor = await resolveActorOr401(c, !room.isDebug, optString(raw.playerId));
    if (actor.response) return actor.response;
    const forbidden = requireHost(c, room, actor.playerId, '只有房主可以修改密码');
    if (forbidden) return forbidden;
    if (room.status !== '等待中') {
      return c.json({ error: '仅等待中可修改密码' }, 400);
    }

    const rawPassword = typeof raw.password === 'string' ? raw.password : '';
    if (rawPassword.length > 32) {
      return c.json({ error: '房间密码长度不能超过 32 位' }, 400);
    }
    room.passwordHash = rawPassword ? await hashPassword(rawPassword) : null;
    notifyRoomChanged(room, 'update');
    broadcastRoomState(room);
    return c.json({ success: true, hasPassword: room.passwordHash !== null });
  });
}
