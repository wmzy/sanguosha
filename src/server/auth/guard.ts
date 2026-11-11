// src/server/auth/guard.ts — 会话身份守卫。
// 从请求解析登录用户:Cookie(浏览器)/ Authorization: Bearer(程序化客户端)/
// ?sgs_token=(SSE EventSource 无法带自定义头时的查询参数通道)。
// 供 rest.ts/sse.ts 对非调试房间强制登录使用;调试房间保持开放(开发工具)。
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { getUserByToken, type PublicUser } from './store';
import { getRoom } from '../room';
import type { Room } from '../room';

/** 会话 Cookie 名(与 routes.ts 写入侧一致,收敛在此避免循环依赖)。 */
export const SESSION_COOKIE = 'sgs_session';

/** 从请求提取会话 token(Cookie → Bearer → 查询参数)。 */
export function extractSessionToken(c: Context): string | null {
  const bearer = c.req.header('Authorization');
  if (bearer && /^Bearer\s+/i.test(bearer)) {
    const token = bearer.replace(/^Bearer\s+/i, '').trim();
    if (token) return token;
  }
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return cookie;
  const q = c.req.query('sgs_token');
  return q ?? null;
}

/** 解析当前登录用户;未登录/会话过期返回 null。 */
export async function getSessionUser(c: Context): Promise<PublicUser | null> {
  const token = extractSessionToken(c);
  if (!token) return null;
  return getUserByToken(token);
}

/** 会话身份解析结果:区分「无凭据」与「凭据无效/过期」,
 *  供需要细分 401 文案的调用方(rest 统一文案 / sse 过期专用文案)各自映射响应。 */
export type SessionIdentity =
  | { user: PublicUser }
  | { reason: 'no_token' }
  | { reason: 'invalid_token' };

/** 解析请求的登录身份:无凭据时不走 DB 查询直接短路标记。 */
export async function resolveSessionIdentity(c: Context): Promise<SessionIdentity> {
  if (!extractSessionToken(c)) return { reason: 'no_token' };
  const user = await getSessionUser(c);
  return user ? { user } : { reason: 'invalid_token' };
}

/** 非调试房间会话身份守卫:解析登录用户,未登录(无凭据或会话无效)返回 null(调用方回 401)。
 *  调试房间与房间列表/详情保持开放(浏览大厅无需登录)。 */
export async function requireUser(c: Context): Promise<PublicUser | null> {
  const identity = await resolveSessionIdentity(c);
  return 'user' in identity ? identity.user : null;
}

/** REST 操作者身份解析(非调试房取会话 userId,调试房回退 bodyPlayerId)。
 *  requireAuth 由调用方按各路由原有语义传入(通常 `!!room && !room.isDebug`;
 *  leave 路由对不存在的房间也要求登录,传 `getRoom(id)?.isDebug !== true`)。
 *  未登录返回 authFailed(调用方回 401);bodyPlayerId 为空串不在本处校验,
 *  由调用方按原路由各自的 400 文案兜底。 */
export async function resolveRoomActorId(
  c: Context,
  requireAuth: boolean,
  bodyPlayerId: string,
): Promise<{ playerId: string } | { authFailed: true }> {
  if (!requireAuth) return { playerId: bodyPlayerId };
  const user = await requireUser(c);
  return user ? { playerId: user.id } : { authFailed: true };
}

/** REST playerId 解析(ready/config/换座族路由共用)。
 *  非调试房间:身份取会话 userId(body.playerId 忽略)。否则任何人可伪造他人准备,
 *  或塞入垃圾 id 使 allReady 的 size 相等判断永假 → 房间永远无法开局。
 *  调试房/房间不存在时取 bodyPlayerId(缺失 400)。 */
export async function resolveRestPlayerId(
  c: Context,
  roomId: string,
  bodyPlayerId: string,
): Promise<{ playerId: string } | { error: string; status: 400 | 401 }> {
  const room = getRoom(roomId);
  if (room && !room.isDebug) {
    const user = await requireUser(c);
    if (!user) return { error: '请先登录', status: 401 };
    return { playerId: user.id };
  }
  if (!bodyPlayerId) return { error: '缺少 playerId', status: 400 };
  return { playerId: bodyPlayerId };
}

/** 审批者(批准/拒绝/撤销旁观者查看申请)必须是本房玩家。
 *  非调试房间按会话 userId 校验 players 成员资格;调试房保持游客模型。 */
export async function resolveApprover(
  c: Context,
  roomId: string,
): Promise<{ playerId: string } | { error: string; status: 401 | 403 }> {
  const room = getRoom(roomId);
  if (room && !room.isDebug) {
    const user = await requireUser(c);
    if (!user) return { error: '请先登录', status: 401 };
    if (!room.players.has(user.id)) return { error: '仅房间内玩家可操作', status: 403 };
    return { playerId: user.id };
  }
  return { playerId: '' };
}

/** 解析房主身份(对局历史删除族路由共用):非调试房优先会话(登录用户 id),
 *  否则 ?playerId= 查询参数或 body。 */
export async function resolvePlayerIdFromBodyOrQuery(
  c: Context,
  room: Room | null,
): Promise<string | null> {
  if (room && !room.isDebug) {
    const user = await requireUser(c);
    return user ? user.id : null;
  }
  const q = c.req.query('playerId');
  if (q) return q;
  try {
    const raw = await c.req.json<Record<string, unknown>>();
    if (raw && typeof raw.playerId === 'string') return raw.playerId;
  } catch {
    /* DELETE 无 body 是合法情况 */
  }
  return null;
}
