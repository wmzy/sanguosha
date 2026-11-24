// src/server/auth/routes.ts — 认证 REST 路由。
// POST /api/auth/register|login|logout, GET /api/auth/me,
// GET /api/auth/github (跳转授权) + GET /api/auth/github/callback。
// 会话 token 存 HttpOnly Cookie(SameSite=Lax);SSE/房间操作仍走 playerId(游客可玩),
// 登录是身份增强而非强制门禁 —— 与「支持用户名密码/OAuth 登录」需求一致。
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createRateLimit, trustedForwardedProto } from '../middleware/rate-limit';
import { createLogger } from '../logger';
import {
  createUser,
  verifyLogin,
  createSession,
  getUserByToken,
  deleteSession,
  upsertGithubUser,
  updateDisplayName,
  changePassword,
  type PublicUser,
} from './store';
import { getGithubConfig, generateState, exchangeCodeForProfile, isGithubEnabled } from './github';
import { extractSessionToken, SESSION_COOKIE } from './guard';
import { readJsonBody, optString } from '../http';
import { applyDisplayName } from '../room';

const log = createLogger('auth-routes');

/** 认证端点限流:见 applyAuthRoutes 内分级配置。 */

/** 会话 Cookie 的 Secure 判定。
 *  线上 TLS 通常由反代终结(应用进程只见 http),旧的 `url.startsWith('https://')`
 *  判断会让 Cookie 永远不带 Secure。优先级:
 *    1. SGS_COOKIE_SECURE=true/false 显式指定(反代终结时推荐 true);
 *    2. 直连 https;
 *    3. 可信代理( SGS_TRUSTED_PROXIES )转发的 X-Forwarded-Proto: https。
 *  不可信 peer 的转发头一律忽略,避免被伪造头引导成不加密的 secure cookie。 */
function sessionCookieSecure(c: Parameters<typeof setCookie>[0]): boolean {
  const forced = process.env.SGS_COOKIE_SECURE?.trim().toLowerCase();
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  if (c.req.url.startsWith('https://')) return true;
  return trustedForwardedProto(c) === 'https';
}

export function applyAuthRoutes(app: Hono): void {
  const auth = new Hono();
  // 分级限流(同为 IP 维度,窗口 60s):
  //   - login/register/logout/password:暴力破解入口,30 req/min。
  //   - me/profile:幂等只读/低危写。/me 在每次整页加载时由 useAuth 探测,
  //     多标签页/频繁刷新即可打满 30/min → 全认证面板瘫痪 60s(可用性缺陷,
  //     e2e 并行 worker 同 IP 下必现)。放宽到 600/min。
  const authStrictLimit = createRateLimit(30);
  // logout 无需登录且幂等,单独限流:与 login/register 共用桶时,30 次匿名 logout
  // 就能让同 IP(未配可信代理时是全体)一分钟内无法登录。
  const authLogoutLimit = createRateLimit(60);
  const authReadLimit = createRateLimit(600);
  auth.use('/login', authStrictLimit);
  auth.use('/register', authStrictLimit);
  auth.use('/logout', authLogoutLimit);
  auth.use('/password', authStrictLimit);
  auth.use('/me', authReadLimit);
  auth.use('/profile', authReadLimit);

  const setSessionCookie = (c: Parameters<typeof setCookie>[0], token: string, expiresAt: number) => {
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: sessionCookieSecure(c),
      path: '/',
      maxAge: Math.floor((expiresAt - Date.now()) / 1000),
    });
  };

  /** 注册/登录共用尾奏:为已通过校验的 user 签发会话——createSession 失败回
   *  503「服务暂不可用」;成功则写 HttpOnly Cookie 并返回同一响应形状
   *  { user, token, expiresAt }(token 同时放响应体:程序化客户端 HGC/MCP
   *  无 Cookie 存储,走 Bearer;泄露面与 Cookie 等价,不下发哈希等敏感字段)。 */
  const issueSessionResponse = async (
    c: Parameters<typeof setCookie>[0],
    user: PublicUser,
  ): Promise<Response> => {
    const session = await createSession(user.id);
    if (!session) return c.json({ error: '服务暂不可用' }, 503);
    setSessionCookie(c, session.token, session.expiresAt);
    return c.json({ user, token: session.token, expiresAt: session.expiresAt });
  };

  // ── 注册 ──
  auth.post('/register', async (c) => {
    const raw = await readJsonBody(c);
    const username = optString(raw.username);
    const password = optString(raw.password);
    const result = await createUser(username, password);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return issueSessionResponse(c, result.user);
  });

  // ── 登录(用户名/密码) ──
  auth.post('/login', async (c) => {
    const raw = await readJsonBody(c);
    const username = optString(raw.username);
    const password = optString(raw.password);
    const result = await verifyLogin(username, password);
    if (!result.ok) return c.json({ error: result.error }, 401);
    return issueSessionResponse(c, result.user);
  });

  // ── 当前用户 ──
  // 身份解析走 extractSessionToken(Cookie → Bearer → ?sgs_token):register/login
  // 把 token 放响应体正是供无 Cookie 存储的程序化客户端(HGC/MCP)使用,
  // 只读 Cookie 会让这类客户端 /me 恒为未登录。
  auth.get('/me', async (c) => {
    const user = await getUserByToken(extractSessionToken(c));
    return c.json({ user, githubEnabled: isGithubEnabled() });
  });

  // ── 登出 ──
  // 同 /me:token 来源不限 Cookie,否则 Bearer 客户端登出删不掉服务端会话。
  auth.post('/logout', async (c) => {
    const token = extractSessionToken(c);
    await deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ success: true });
  });

  // ── 个人资料 ──
  // PATCH /api/auth/profile — 修改昵称。房间内显示名实时同步(applyDisplayName 广播)。
  auth.patch('/profile', async (c) => {
    const me = await getUserByToken(extractSessionToken(c));
    if (!me) return c.json({ error: '请先登录' }, 401);
    const raw = await readJsonBody(c);
    const displayName = optString(raw.displayName);
    const updated = await updateDisplayName(me.id, displayName);
    if (!updated) return c.json({ error: '昵称不合法(1-24位,不含空格)' }, 400);
    applyDisplayName(me.id, updated.displayName);
    return c.json({ user: updated });
  });

  // ── 修改密码 ──
  auth.put('/password', async (c) => {
    const me = await getUserByToken(extractSessionToken(c));
    if (!me) return c.json({ error: '请先登录' }, 401);
    const raw = await readJsonBody(c);
    const oldPassword = optString(raw.oldPassword);
    const newPassword = optString(raw.newPassword);
    const result = await changePassword(me.id, oldPassword, newPassword);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ user: result.user });
  });

  // ── GitHub OAuth:跳转授权页 ──
  // state 存 Cookie 由 GitHub 原样带回,callback 校验防 CSRF。
  auth.get('/github', (c) => {
    const config = getGithubConfig();
    if (!config) return c.json({ error: 'GitHub 登录未配置' }, 503);
    const state = generateState();
    const origin = new URL(c.req.url).origin;
    const redirectUri = `${origin}/api/auth/github/callback`;
    const authorizeUrl =
      `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(config.clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${encodeURIComponent(state)}`;
    setCookie(c, 'sgs_oauth_state', state, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: origin.startsWith('https'),
      path: '/',
      maxAge: 600,
    });
    return c.redirect(authorizeUrl);
  });

  // ── GitHub OAuth:回调 ──
  auth.get('/github/callback', async (c) => {
    const config = getGithubConfig();
    if (!config) return c.redirect('/?authError=github_not_configured');
    const code = c.req.query('code');
    const state = c.req.query('state');
    const expectedState = getCookie(c, 'sgs_oauth_state');
    if (!code || !state || !expectedState || state !== expectedState) {
      return c.redirect('/?authError=invalid_state');
    }
    try {
      const origin = new URL(c.req.url).origin;
      const profile = await exchangeCodeForProfile(code, config, `${origin}/api/auth/github/callback`);
      const result = await upsertGithubUser(profile);
      if (!result.ok) return c.redirect('/?authError=db_unavailable');
      const session = await createSession(result.user.id);
      if (!session) return c.redirect('/?authError=db_unavailable');
      setSessionCookie(c, session.token, session.expiresAt);
      deleteCookie(c, 'sgs_oauth_state', { path: '/' });
      return c.redirect('/');
    } catch (err) {
      log.error('GitHub OAuth 回调失败', { error: String(err) });
      return c.redirect('/?authError=github_failed');
    }
  });

  app.route('/api/auth', auth);
}
