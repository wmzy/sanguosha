// server/routes/spectator-routes.ts — 旁观者/查看授权/身份切换路由(自 rest.ts 拆出)。
// 路由路径/方法/校验顺序/响应形状与拆分前完全一致。

import type { Context, Hono } from 'hono';
import {
  getRoom,
  broadcastMessage,
  joinAsSpectator,
  switchRole,
  requestView,
  approveView,
  rejectView,
  revokeView,
  checkRoomPassword,
  type Room,
} from '../room';
import { requireUser, resolveApprover } from '../auth/guard';
import type { ServerMessage } from '../protocol';
import { gameSessions, playerRoomMap } from '../registry';
import {
  authRequired,
  broadcastRoomState,
  detachFromOtherRooms,
  nullSink,
  optString,
  readJsonBody,
  resolvePlayerOrRespond,
} from './helpers';

/** 旁观查看审批族路由(approve/reject/revoke-view)共用骨架的差异化参数。 */
interface ViewAuthRouteSpec {
  /** 缺参 400 文案。 */
  missingParamError: string;
  /** 房间操作失败 400 文案。 */
  failedError: string;
  /** 是否要求 targetSeat(approve-view 需指定批准的座次)。 */
  requireTargetSeat?: boolean;
  /** 房间操作;返回 null → failedError。 */
  execute: (roomId: string, spectatorId: string, targetSeat: number) => Room | null;
  /** 成功后的附加广播消息(先于 room_state);缺省仅广播 room_state。 */
  notify?: (spectatorId: string, targetSeat: number) => ServerMessage;
  /** 是否清除旁观者 baseline 并在游戏进行中重发其初始视图(approve/revoke)。 */
  refreshView?: boolean;
}

/** 旁观查看审批族路由(approve/reject/revoke-view)同构骨架:
 *  解析 spectatorId(approve 另需 targetSeat)→ 审批者校验 → 房间操作(失败 400)
 *  → 可选清除旁观 baseline → 附加广播 + room_state → 游戏进行中可选重发视图。 */
async function handleViewAuthRoute(c: Context, spec: ViewAuthRouteSpec): Promise<Response> {
  const roomId = c.req.param('id')!;
  const raw = await readJsonBody(c);
  const spectatorId = optString(raw.spectatorId);
  const targetSeat = typeof raw.targetSeat === 'number' ? raw.targetSeat : -1;
  if (!spectatorId || (spec.requireTargetSeat && targetSeat < 0)) {
    return c.json({ error: spec.missingParamError }, 400);
  }

  const approver = await resolveApprover(c, roomId);
  if ('error' in approver) return c.json({ error: approver.error }, approver.status);

  const room = spec.execute(roomId, spectatorId, targetSeat);
  if (!room) return c.json({ error: spec.failedError }, 400);

  // 清除旁观者 baseline,强制重发新 viewer 的 initialView(approve)或公开视图(revoke)
  const session = gameSessions.get(roomId);
  if (spec.refreshView && session) {
    session.clearSpectatorBaseline(spectatorId);
  }

  if (spec.notify) {
    broadcastMessage(room, spec.notify(spectatorId, targetSeat));
  }
  broadcastRoomState(room);

  // 如果游戏进行中,立即发送新视图
  if (spec.refreshView && session && room.status === '进行中') {
    session.sendSpectatorInitialView(spectatorId);
  }

  return c.json({ success: true });
}

/** 注册旁观者/查看授权/身份切换路由。 */
export function applySpectatorRoutes(app: Hono): void {
  // POST /api/rooms/:id/join-spectator — 以旁观者身份加入房间
  app.post('/api/rooms/:id/join-spectator', async (c) => {
    const roomId = c.req.param('id');
    const room = getRoom(roomId);

    const raw = await readJsonBody(c);

    // 旁观同样需要登录(需求:旁观也要登录后才能进房间查看;鉴权先于存在性检查)
    const user = await requireUser(c);
    if (!user) return authRequired(c);
    if (!room) return c.json({ error: '房间不存在' }, 404);
    const spectatorId = user.id;

    // 有密码房间:旁观同样需要密码;已是本房旁观者(spectators 含该 id,重连/刷新)豁免
    if (room.passwordHash && !room.spectators.has(spectatorId)) {
      const password = typeof raw.password === 'string' ? raw.password : '';
      const ok = await checkRoomPassword(room, password);
      if (!ok) return c.json({ error: '房间密码错误', code: 'ROOM_PASSWORD_REQUIRED' }, 403);
    }

    // 清理旧房间关联(仅限其他房间的残留;同房走下方 switchRole 就地转换)
    detachFromOtherRooms(spectatorId, roomId, true);

    // 同房玩家(含房主)转旁观:必须就地 switchRole 释放座位并保留房间。
    // 若走 leave+rejoin,quick 房会在 host leave 时被「全员离开自动销毁」
    // 直接删掉,随后的旁观加入撞上已删房间 → 永远 400「加入失败」。
    const isSameRoomPlayer =
      room.players.has(spectatorId) || room.seats.includes(spectatorId);
    if (isSameRoomPlayer) {
      const switched = switchRole(roomId, spectatorId, 'spectator');
      if (!switched.success) return c.json({ error: '加入失败' }, 400);
    } else {
      const joined = joinAsSpectator(roomId, spectatorId, nullSink(), user.displayName);
      if (!joined) return c.json({ error: '加入失败' }, 400);
    }
    playerRoomMap.set(spectatorId, roomId);

    broadcastMessage(room, { type: 'spectator_joined', spectatorId });
    broadcastRoomState(room);

    return c.json({ roomId, playerId: spectatorId, playerName: user.displayName });
  });

  // POST /api/rooms/:id/switch-role — 切换玩家身份（等待中）
  app.post('/api/rooms/:id/switch-role', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    const newRole = raw.role === 'spectator' ? 'spectator' : raw.role === 'player' ? 'player' : '';
    if (!newRole) return c.json({ error: '缺少 role' }, 400);
    // 非调试房间:身份取会话 userId,防伪造他人换身份/占座
    const resolved = await resolvePlayerOrRespond(c, roomId, optString(raw.playerId));
    if (resolved.response) return resolved.response;
    const playerId = resolved.playerId;
    // 可选座位号：spectator→player 时占据指定空座位
    const seat = typeof raw.seat === 'number' ? raw.seat : undefined;

    const result = switchRole(roomId, playerId, newRole, seat);
    if (!result.room) return c.json({ error: '房间不存在' }, 404);
    if (!result.success) return c.json({ error: '切换失败（仅等待中/已结束允许，或房间已满）' }, 400);

    broadcastMessage(result.room, { type: 'role_changed', playerId, newRole });
    broadcastRoomState(result.room);
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/request-view — 旁观者申请查看指定座次
  app.post('/api/rooms/:id/request-view', async (c) => {
    const roomId = c.req.param('id');
    const raw = await readJsonBody(c);
    const targetSeat = typeof raw.targetSeat === 'number' ? raw.targetSeat : -1;
    if (targetSeat < 0) return c.json({ error: '缺少 targetSeat' }, 400);
    // 非调试房间:spectatorId 取会话 userId,防以他人名义发起申请
    const resolved = await resolvePlayerOrRespond(c, roomId, optString(raw.spectatorId));
    if (resolved.response) return resolved.response;
    const spectatorId = resolved.playerId;

    const room = requestView(roomId, spectatorId, targetSeat);
    if (!room) return c.json({ error: '申请失败' }, 400);

    // 广播 view_request(客户端日志) + room_state(含更新后的 pendingViewRequests,
    // 驱动审批 UI——客户端从 room_state 同步 pendingViewRequests,而非 view_request 消息)
    broadcastMessage(room, { type: 'view_request', spectatorId, targetSeat });
    broadcastRoomState(room);
    return c.json({ success: true });
  });

  // POST /api/rooms/:id/approve-view — 玩家审批通过
  // 非调试房间:审批者必须是本房玩家(会话 userId ∈ players)。
  // 无校验时任何人都可批准旁观者查看任意座次 → 直接泄露该座次私有视图。
  app.post('/api/rooms/:id/approve-view', (c) =>
    handleViewAuthRoute(c, {
      missingParamError: '缺少参数',
      failedError: '审批失败',
      requireTargetSeat: true,
      execute: (roomId, spectatorId, targetSeat) => approveView(roomId, spectatorId, targetSeat),
      notify: (spectatorId, targetSeat) => ({
        type: 'view_granted',
        spectatorId,
        seatIndex: targetSeat,
      }),
      refreshView: true,
    }));

  // POST /api/rooms/:id/reject-view — 玩家拒绝申请(审批者校验同 approve-view)
  app.post('/api/rooms/:id/reject-view', (c) =>
    handleViewAuthRoute(c, {
      missingParamError: '缺少 spectatorId',
      failedError: '操作失败',
      execute: (roomId, spectatorId) => rejectView(roomId, spectatorId),
    }));

  // POST /api/rooms/:id/revoke-view — 玩家撤销已授权(审批者校验同 approve-view)
  app.post('/api/rooms/:id/revoke-view', (c) =>
    handleViewAuthRoute(c, {
      missingParamError: '缺少 spectatorId',
      failedError: '操作失败',
      execute: (roomId, spectatorId) => revokeView(roomId, spectatorId),
      notify: (spectatorId) => ({ type: 'view_revoked', spectatorId }),
      refreshView: true,
    }));
}
