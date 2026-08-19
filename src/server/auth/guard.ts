// src/server/auth/guard.ts — 会话身份守卫。
// 从请求解析登录用户:Cookie(浏览器)/ Authorization: Bearer(程序化客户端)/
// ?sgs_token=(SSE EventSource 无法带自定义头时的查询参数通道)。
// 供 rest.ts/sse.ts 对非调试房间强制登录使用;调试房间保持开放(开发工具)。
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { getUserByToken, type PublicUser } from './store';

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
