// server/routes/game-routes.ts — 对局操作/聊天/日志/快照路由(自 rest.ts 拆出)。
// 路由路径/方法/校验顺序/响应形状与拆分前完全一致。

import type { Hono } from 'hono';
import {
  setReady,
  unsetReady,
  allReady,
  getRoom,
  broadcastMessage,
  addChatMessage,
  resetChatUsage,
  getChatHistory,
} from '../room';
import {
  createSnapshot,
  patchSnapshotDescription,
  type CreateSnapshotRequest,
} from '../snapshot';
import { GameSession } from '../session';
import { gameSessions } from '../registry';
import {
  broadcastRoomState,
  optString,
  readJsonBody,
  requireRoomMember,
  requireSessionHost,
  resolveActorOr401,
  resolvePlayerOrRespond,
} from './helpers';

/** 校验 REST action 载荷结构(playerId 之外的完整形状)。 */
function isRestAction(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  if (
    typeof action.skillId !== 'string' ||
    typeof action.actionType !== 'string' ||
    typeof action.ownerId !== 'number' ||
    !Number.isInteger(action.ownerId) ||
    typeof action.baseSeq !== 'number' ||
    !Number.isFinite(action.baseSeq) ||
    typeof action.params !== 'object' ||
    action.params === null ||
    Array.isArray(action.params)
  ) return false;
  if (action.preceding === undefined) return true;
  if (!Array.isArray(action.preceding)) return false;
  return action.preceding.every((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
    const p = item as Record<string, unknown>;
    return (
      typeof p.skillId === 'string' &&
      typeof p.actionType === 'string' &&
      typeof p.params === 'object' &&
      p.params !== null &&
      !Array.isArray(p.params)
    );
  });
}

/** 注册对局操作/聊天/日志/快照路由。 */
export function applyGameRoutes(app: Hono): void {
  app.get('/api/rooms/:id/log', async (c) => {
    const id = c.req.param('id');
    const session = gameSessions.get(id);
    if (!session) return c.json({ error: '会话不存在' }, 404);
    // 动作日志是完整实时战报:非调试房间仅本房成员(玩家/旁观者,登录会话)可读,
    // 防止未登录者凭 roomId 拉取进行中对局的全部动作细节。
    const room = getRoom(id);
    const member = await requireRoomMember(c, room, '仅房间成员可查看日志');
    if (member.error) return member.error;
    const gameLog = session.getPublicGameLog();
    if (!gameLog) return c.json({ error: '无游戏日志' }, 404);
    return c.json(gameLog);
  });

  // ── 游戏操作路由（替代 WS C→S 消息） ──

  // POST /api/rooms/:id/ready — 玩家准备
  // 非调试房间:身份取会话 userId(body.playerId 忽略)。否则任何人可伪造他人准备,
  // 或塞入垃圾 id 使 allReady 的 size 相等判断永假 → 房间永远无法开局。
  // (身份解析见 routes/helpers.ts 的 resolvePlayerOrRespond。)
  app.post('/api/rooms/:id/ready', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    const resolved = await resolvePlayerOrRespond(c, roomId, optString(raw.playerId));
    if (resolved.response) return resolved.response;
    const playerId = resolved.playerId;

    const ok = setReady(roomId, playerId);
    if (!ok) {
      const room = getRoom(roomId);
      const reason = !room
        ? '房间不存在'
        : room.status !== '等待中'
          ? '房间已开局,无需准备'
          : '准备失败';
      return c.json({ error: reason }, 400);
    }

    const room = getRoom(roomId);
    if (room) {
      broadcastMessage(room, { type: 'player_ready', playerId });
      broadcastRoomState(room);
    }
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/cancel-ready — 玩家取消准备(身份解析同 ready)
  app.post('/api/rooms/:id/cancel-ready', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    const resolved = await resolvePlayerOrRespond(c, roomId, optString(raw.playerId));
    if (resolved.response) return resolved.response;
    const playerId = resolved.playerId;

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
    const raw = await readJsonBody(c);

    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);

    // 非 debug 房间:身份取会话 userId(body.playerId 可伪造 hostId 绕过下方校验,
    // 强行在未全员准备时开局);调试房间任意座次可触发。
    const actor = await resolveActorOr401(c, !room.isDebug, optString(raw.playerId));
    if (actor.response) return actor.response;
    const playerId = actor.playerId;

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
  // 破坏性操作(resetToLobby 清空进行中对局回大厅):非调试房间仅房主,
  // 否则任何人可对任意 roomId 重置他人正在进行的游戏。
  app.post('/api/rooms/:id/restart', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    const session = gameSessions.get(roomId);
    if (!session) return c.json({ error: '游戏会话不存在' }, 404);

    const forbidden = await requireSessionHost(c, room, '只有房主可以再来一局');
    if (forbidden) return forbidden;

    session.resetToLobby();
    resetChatUsage(roomId);
    broadcastRoomState(room);
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/action — 提交玩家操作
  // 非 debug 房间:playerId 取会话 userId。handleAction 仅校验 ownerId 与
  // playerNames[playerId] 的座次映射,不校验请求者真实身份——信任 body.playerId
  // 时,任何知道受害者 userId 者(历史条目公开)可替其出牌/回应。
  app.post('/api/rooms/:id/action', async (c) => {
    const roomId = c.req.param('id');
    const rawValue: unknown = await c.req.json().catch(() => ({}));
    const raw =
      typeof rawValue === 'object' && rawValue !== null && !Array.isArray(rawValue)
        ? (rawValue as Record<string, unknown>)
        : {};
    let playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
    const action = raw.action;
    if (!playerId || !isRestAction(action)) return c.json({ error: '缺少 playerId 或 action', code: 'INVALID_ACTION' }, 400);

    const session = gameSessions.get(roomId);
    if (!session) return c.json({ error: '游戏会话不存在' }, 404);

    const room = getRoom(roomId);
    const actor = await resolveActorOr401(c, !!room && !room.isDebug, playerId);
    if (actor.response) return actor.response;
    playerId = actor.playerId;

    // session.handleAction 内部处理 reject（通过 SSE 推 actionRejected）
    await session.handleAction(playerId, action as never);
    return c.json({ accepted: true });
  });

  // POST /api/rooms/:id/reorder — 重排手牌(身份解析同 action)
  app.post('/api/rooms/:id/reorder', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    let playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
    const order = raw.order;
    if (!playerId || !Array.isArray(order) || !order.every((id) => typeof id === 'string')) {
      return c.json({ error: '缺少参数或 order 必须是字符串数组', code: 'INVALID_REORDER' }, 400);
    }

    const session = gameSessions.get(roomId);
    if (!session) return c.json({ error: '游戏会话不存在' }, 404);

    const room = getRoom(roomId);
    const actor = await resolveActorOr401(c, !!room && !room.isDebug, playerId);
    if (actor.response) return actor.response;
    playerId = actor.playerId;

    const accepted = session.handleReorderHand(playerId, order);
    if (!accepted) {
      return c.json({ error: 'order 必须是当前手牌的完整排列', code: 'INVALID_REORDER' }, 400);
    }
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/chat — 发送聊天消息
  app.post('/api/rooms/:id/chat', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    const text = typeof raw.text === 'string' ? raw.text : '';

    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);

    // 身份解析:非调试房间一律取会话 userId(body.playerId 忽略,防冒充他人发言);
    // 调试房保持游客模型(query/body.playerId)。
    const actor = await resolveActorOr401(c, !room.isDebug, optString(raw.playerId));
    if (actor.response) return actor.response;
    const playerId = actor.playerId;
    if (!playerId) return c.json({ error: '缺少 playerId' }, 400);
    if (!room.players.has(playerId)) return c.json({ error: '不在房间中' }, 403);

    const result = addChatMessage(roomId, playerId, text);
    if (!result.ok) return c.json({ error: result.error }, 400);

    // 座次必须从 seats 数组反查:players Map 的 key 序是连接建立序,
    // 断线重连/换座后与真实座次无关,用它当 seatIndex 会把消息挂到错误座位卡上。
    const seatIndex = room.seats.indexOf(playerId);
    broadcastMessage(room, {
      type: 'chat',
      playerId,
      seatIndex,
      text: text.trim(),
      timestamp: Date.now(),
    });

    return c.json({ success: true, remaining: result.remaining });
  });

  // GET /api/rooms/:id/chat/history — 获取聊天历史
  // 聊天记录是房间私有信息(含玩家实时发言):非调试房间与 /log 同款防护——
  // 必须登录且为本房成员(玩家/旁观者),防止未登录者凭 roomId 拉取全部发言。
  app.get('/api/rooms/:id/chat/history', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    const member = await requireRoomMember(c, room, '仅房间成员可查看聊天记录');
    if (member.error) return member.error;
    return c.json(getChatHistory(roomId));
  });

  // Debug 快照:保存前后端完整游戏状态到 data/snapshots/
  app.post('/api/snapshot', async (c) => {
    const body = await readJsonBody(c);
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
    const body = await readJsonBody(c);
    if (!body || typeof body.description !== 'string') {
      return c.json({ error: '缺少 description' }, 400);
    }
    const result = await patchSnapshotDescription(snapshotId, body.description);
    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.json(result);
  });
}
