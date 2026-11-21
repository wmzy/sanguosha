// server/routes/helpers.ts — REST 路由共享助手(自 rest.ts 拆出)。
// body 解析、鉴权 401/403/400 响应构造、身份解析适配、跨房间清理与广播,
// 供 room/game/spectator/seat/history 各路由文件复用;路由路径与响应形状不变。

import type { Context } from 'hono';
import {
  broadcastMessage,
  broadcastRoomState,
  checkRoomPassword,
  findRoomByPlayerId,
  getRoom,
  leaveRoom,
  removeSpectator,
  type Room,
} from '../room';
import { checkRoomAccess, resolveRoomActor } from '../auth/guard';
import { hashPassword } from '../auth/password';
import type { PublicUser } from '../auth/store';
import type { ServerMessage } from '../protocol';
import type { ConnectionSink } from '../connection';
import { gameSessions } from '../registry';
import type { GameSession } from '../session';

// 请求体读取/字段提取(readJsonBody/optString)单点在 server/http.ts,
// 路由文件直接从 '../http' 导入。

/** 统一 401 未登录响应(文案与既有路由一致,带 AUTH_REQUIRED code)。 */
export function authRequired(c: Context): Response {
  return c.json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401);
}

/** 房间存在性守卫:房间不存在时返回 404「房间不存在」,存在时返回房间本身。
 *  返回值 instanceof Response 时调用方直接 return。
 *  需要鉴权先于存在性检查的路由(join 族)应在 401 判定之后调用本守卫。 */
export function requireRoom(c: Context, roomId: string): Room | Response {
  return getRoom(roomId) ?? c.json({ error: '房间不存在' }, 404);
}

// broadcastRoomState 定义单点在 room.ts(紧邻 buildRoomState,room.ts 内部广播与
// 路由共用);路由文件直接从 '../room' 导入。

/** 房间密码入参解析 + 哈希(创建房间/修改密码共用):非字符串按空串,
 *  超 32 位回 400;否则返回 scrypt 哈希(空密码 = null,即无密码/清除密码)。
 *  返回值 instanceof Response 时调用方直接 return。 */
export async function parseRoomPassword(
  c: Context,
  raw: Record<string, unknown>,
): Promise<Response | string | null> {
  const password = typeof raw.password === 'string' ? raw.password : '';
  if (password.length > 32) {
    return c.json({ error: '房间密码长度不能超过 32 位' }, 400);
  }
  return password ? await hashPassword(password) : null;
}

/** 路由成功路径的标准尾奏：先广播事件消息，再广播 room_state。
 *  excludeId 语义同 broadcastMessage（事件消息排除该成员，room_state 仍全员）。 */
export function notifyRoom(room: Room, message: ServerMessage, excludeId?: string): void {
  broadcastMessage(room, message, excludeId);
  broadcastRoomState(room);
}

/** 进房密码校验（玩家/旁观加入路由共用）。
 *  无密码房间恒过；exempt=true 时跳过（已是本房成员的重连/刷新，豁免条件由
 *  调用方判定）。有密码且校验失败 → 统一 403 响应；放行返回 null。 */
export async function requireRoomPassword(
  c: Context,
  room: Room,
  password: unknown,
  exempt = false,
): Promise<Response | null> {
  if (!room.passwordHash || exempt) return null;
  const plain = typeof password === 'string' ? password : '';
  const ok = await checkRoomPassword(room, plain);
  return ok ? null : c.json({ error: '房间密码错误', code: 'ROOM_PASSWORD_INVALID' }, 403);
}

/** 解析 body.targetSeat；缺失/类型不符回退 -1（调用方按 <0 回 400）。 */
export function parseTargetSeat(raw: Record<string, unknown>): number {
  return typeof raw.targetSeat === 'number' ? raw.targetSeat : -1;
}

/** 创建 null sink（REST 入口无活跃连接时占位）。 */
export function nullSink(): ConnectionSink {
  return { send: () => {}, close: () => {}, isAlive: false };
}

/** 身份解析适配结果:response 非空时调用方直接 `return xxx.response`。 */
export type ResolvedPlayer =
  | { playerId: string; response?: undefined }
  | { playerId?: undefined; response: Response };

/** 底层身份适配:requireAuth=true 时取会话 userId(未登录回 401,带
 *  AUTH_REQUIRED code),否则回退 bodyPlayerId(可为空串,调用方 400 兜底)。
 *  requireAuth 的推导已单点化到 resolveRoomRequestActor,本适配器仅由
 *  resolveSessionActor 内部复用(action/reorder,requireAuth 来自会话房的
 *  session-first 语义,见其注释)。 */
export async function resolveActorOr401(
  c: Context,
  requireAuth: boolean,
  bodyPlayerId: string,
): Promise<ResolvedPlayer> {
  const actor = await resolveRoomActor(c, { requireAuth }, bodyPlayerId);
  return actor.error ? { response: authRequired(c) } : { playerId: actor.playerId };
}

/** 「非调试房间需鉴权」操作者解析单点(leave/kick/start/chat/password 族):
 *  内部 getRoom(roomId) 推导 requireAuth——非调试房与房间不存在(fail-closed,
 *  防凭空 roomId 绕过会话校验)一律取会话 userId,未登录回 401(AUTH_REQUIRED);
 *  调试房回退 bodyPlayerId(可为空串,调用方 400 兜底)。
 *  opts.requireRoom=true 时房间不存在先回 404「房间不存在」(校验顺序与原
 *  requireRoom → 身份解析一致),成功分支附带非空 room;缺省不校验存在性也
 *  不返回 room(缺失房由调用方处理:leave 幂等离开 / kick 交给 kickPlayer
 *  的 roomNotFound 分支)。response 非空时调用方直接 `return xxx.response`。 */
export async function resolveRoomRequestActor(
  c: Context,
  roomId: string,
  bodyPlayerId: string,
  opts: { requireRoom: true },
): Promise<
  | { room: Room; playerId: string; response?: undefined }
  | { room?: undefined; playerId?: undefined; response: Response }
>;
export async function resolveRoomRequestActor(
  c: Context,
  roomId: string,
  bodyPlayerId: string,
  opts?: { requireRoom?: boolean },
): Promise<ResolvedPlayer>;
export async function resolveRoomRequestActor(
  c: Context,
  roomId: string,
  bodyPlayerId: string,
  opts: { requireRoom?: boolean } = {},
): Promise<
  | { room: Room | null; playerId: string; response?: undefined }
  | { room?: undefined; playerId?: undefined; response: Response }
> {
  const room = getRoom(roomId);
  if (!room && opts.requireRoom) return { response: c.json({ error: '房间不存在' }, 404) };
  const requireAuth = !room?.isDebug;
  const actor = await resolveRoomActor(c, { requireAuth }, bodyPlayerId);
  return actor.error ? { response: authRequired(c) } : { room, playerId: actor.playerId };
}

/** 对局会话操作者的共用前奏(action/reorder):会话不存在回 404「游戏会话不存在」;
 *  否则解析操作者身份(非调试房取会话 userId,调试房回退 body.playerId——
 *  信任 body.playerId 的安全问题见 game-routes 的 action 路由注释)并回填最终 playerId。
 *  response 非空时调用方直接 `return xxx.response`。 */
export async function resolveSessionActor(
  c: Context,
  roomId: string,
  playerId: string,
): Promise<
  | { session: GameSession; playerId: string; response?: undefined }
  | { session?: undefined; playerId?: undefined; response: Response }
> {
  const session = gameSessions.get(roomId);
  if (!session) return { response: c.json({ error: '游戏会话不存在' }, 404) };
  const room = getRoom(roomId);
  const actor = await resolveActorOr401(c, !!room && !room.isDebug, playerId);
  if (actor.response) return { response: actor.response };
  return { session, playerId: actor.playerId };
}

/** 路由 playerId 解析(ready/config/换座族):非调试房取会话 userId
 *  (body.playerId 忽略);调试房/房间不存在回退 bodyPlayerId。
 *  未登录回 401(带 AUTH_REQUIRED code,与 authRequired 一致);
 *  回退身份缺失回 400「缺少 playerId」。 */
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
  if (actor.error === 'unauthenticated') {
    return { response: authRequired(c) };
  }
  if (actor.error) return { response: c.json({ error: '缺少 playerId' }, 400) };
  return { playerId: actor.playerId };
}

/** 非调试房间的成员(玩家/旁观者)读取守卫(log/chat/history 族):
 *  未登录回 401(AUTH_REQUIRED);登录但非本房成员回 403(forbidden 文案)。
 *  调试房间/房间不存在直接放行(user 为 null,调用方保持游客模型)。
 *  身份+角色校验单点见 auth/guard 的 checkRoomAccess。 */
export async function requireRoomMember(
  c: Context,
  room: Room | null,
  forbidden: string,
): Promise<{ user: PublicUser | null; error: Response | null }> {
  const access = await checkRoomAccess(c, room, 'member');
  if (access.kind === 'open') return { user: null, error: null };
  if (access.kind === 'unauthenticated') return { user: null, error: authRequired(c) };
  if (access.kind === 'forbidden') return { user: null, error: c.json({ error: forbidden }, 403) };
  return { user: access.user, error: null };
}

/** 非调试房间的房主守卫(会话身份;删除房间/再来一局):未登录回 401,非房主回 403。
 *  调试房间(debug 工作流无房主概念)与房间不存在(调用方幂等清理)直接放行。
 *  身份+角色校验单点见 auth/guard 的 checkRoomAccess。 */
export async function requireSessionHost(
  c: Context,
  room: Room | null,
  forbidden: string,
): Promise<Response | null> {
  const access = await checkRoomAccess(c, room, 'host');
  if (access.kind === 'unauthenticated') return authRequired(c);
  if (access.kind === 'forbidden') return c.json({ error: forbidden }, 403);
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
 *  所在房间经 findRoomByPlayerId 查 playerRoomMap(含成员身份校验与残留懒清理),
 *  不再线性扫描房间表。
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
  // playerRoomMap 由 leaveRoom/removeSpectator 内部解除
}
