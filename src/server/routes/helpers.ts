// server/routes/helpers.ts — REST 路由共享助手(自 rest.ts 拆出)。
// body 解析、鉴权 401/403/400 响应构造、身份解析适配、跨房间清理与广播,
// 供 room/game/spectator/seat/history 各路由文件复用;路由路径与响应形状不变。

import type { Context } from 'hono';
import {
  broadcastMessage,
  buildRoomState,
  findRoomByPlayerId,
  getRoom,
  isRoomMember,
  leaveRoom,
  removeSpectator,
  type Room,
} from '../room';
import { requireUser, resolveRoomActor } from '../auth/guard';
import type { PublicUser } from '../auth/store';
import { playerRoomMap } from '../registry';
import type { ConnectionSink } from '../connection';

/** 读取 JSON body;缺失/解析失败回退空对象(与原 rest.ts 各路由内联写法一致)。 */
export async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
}

/** 提取可选字符串字段(缺失/类型不符回退空串)。 */
export function optString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 统一 401 未登录响应(文案与既有路由一致,带 AUTH_REQUIRED code)。 */
export function authRequired(c: Context): Response {
  return c.json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401);
}

/** 广播 room_state 给房间内所有连接。 */
export function broadcastRoomState(room: Room): void {
  broadcastMessage(room, buildRoomState(room));
}

/** 创建 null sink（REST 入口无活跃连接时占位）。 */
export function nullSink(): ConnectionSink {
  return { send: () => {}, close: () => {}, isAlive: false };
}

/** 身份解析适配结果:response 非空时调用方直接 `return xxx.response`。 */
export type ResolvedPlayer =
  | { playerId: string; response?: undefined }
  | { playerId?: undefined; response: Response };

/** 房间操作者身份(start/action/reorder/chat/leave/kick/password 族)。
 *  非调试房取会话 userId;调试房回退 bodyPlayerId(可为空串,调用方 400 兜底)。
 *  未登录回 401(带 AUTH_REQUIRED code)。 */
export async function resolveActorOr401(
  c: Context,
  requireAuth: boolean,
  bodyPlayerId: string,
): Promise<ResolvedPlayer> {
  const actor = await resolveRoomActor(c, { requireAuth }, bodyPlayerId);
  return actor.error ? { response: authRequired(c) } : { playerId: actor.playerId };
}

/** 路由 playerId 解析(ready/config/换座族):非调试房取会话 userId
 *  (body.playerId 忽略);调试房/房间不存在回退 bodyPlayerId。
 *  未登录回 401(无 code,与该族原路由一致);回退身份缺失回 400「缺少 playerId」。 */
export async function resolvePlayerOrRespond(
  c: Context,
  roomId: string,
  bodyPlayerId: string,
): Promise<ResolvedPlayer> {
  const room = getRoom(roomId);
  const actor = await resolveRoomActor(
    c,
    { requireAuth: !!room && !room.isDebug, rejectMissingBodyId: true },
    bodyPlayerId,
  );
  if (actor.error === 'unauthenticated') return { response: c.json({ error: '请先登录' }, 401) };
  if (actor.error) return { response: c.json({ error: '缺少 playerId' }, 400) };
  return { playerId: actor.playerId };
}

/** 非调试房间的成员(玩家/旁观者)读取守卫(log/chat/history 族):
 *  未登录回 401(AUTH_REQUIRED);登录但非本房成员回 403(forbidden 文案)。
 *  调试房间/房间不存在直接放行(user 为 null,调用方保持游客模型)。 */
export async function requireRoomMember(
  c: Context,
  room: Room | null,
  forbidden: string,
): Promise<{ user: PublicUser | null; error: Response | null }> {
  if (!room || room.isDebug) return { user: null, error: null };
  const user = await requireUser(c);
  if (!user) return { user: null, error: authRequired(c) };
  if (!isRoomMember(room, user.id)) {
    return { user: null, error: c.json({ error: forbidden }, 403) };
  }
  return { user, error: null };
}

/** 非调试房间的房主守卫(会话身份;删除房间/再来一局):未登录回 401,非房主回 403。
 *  调试房间(debug 工作流无房主概念)与房间不存在(调用方幂等清理)直接放行。 */
export async function requireSessionHost(
  c: Context,
  room: Room | null,
  forbidden: string,
): Promise<Response | null> {
  if (!room || room.isDebug) return null;
  const user = await requireUser(c);
  if (!user) return authRequired(c);
  if (room.hostId !== user.id) return c.json({ error: forbidden }, 403);
  return null;
}

/** 已解析身份后的房主校验(密码/历史删除族):身份缺失回 400,非房主回 403。 */
export function requireHost(
  c: Context,
  room: Room,
  playerId: string | null,
  forbidden: string,
): Response | null {
  if (!playerId) return c.json({ error: '缺少 playerId' }, 400);
  if (room.hostId !== playerId) return c.json({ error: forbidden }, 403);
  return null;
}

/** 清理玩家在其他房间的残留成员身份(跨房间切换),并清除房间映射。
 *  exceptRoomId: 该房间本身不清理(同房重连/就地转换);缺省 = 全部清理(调试房重进)。
 *  spectatorAware: true 时旧房间若为旁观身份走 removeSpectator(旁观者加入路由),
 *  否则统一 leaveRoom。 */
export function detachFromOtherRooms(
  playerId: string,
  exceptRoomId?: string,
  spectatorAware = false,
): void {
  const existingRoom = findRoomByPlayerId(playerId);
  if (!existingRoom || existingRoom.id === exceptRoomId) return;
  if (spectatorAware && existingRoom.spectators.has(playerId)) {
    removeSpectator(existingRoom.id, playerId);
  } else {
    leaveRoom(existingRoom.id, playerId);
  }
  playerRoomMap.delete(playerId);
}
