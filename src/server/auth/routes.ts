// src/server/auth/routes.ts — 认证 REST 路由。
// POST /api/auth/register|login|logout, GET /api/auth/me,
// GET /api/auth/github (跳转授权) + GET /api/auth/github/callback。
// 会话 token 存 HttpOnly Cookie(SameSite=Lax);SSE/房间操作仍走 playerId(游客可玩),
// 登录是身份增强而非强制门禁 —— 与「支持用户名密码/OAuth 登录」需求一致。
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createRateLimit } from '../middleware/rate-limit';
import { createLogger } from '../logger';
import {
  createUser,
  verifyLogin,
  createSession,
  getUserByToken,
  deleteSession,
  upsertGithubUser,
} from './store';
import { getGithubConfig, generateState, exchangeCodeForProfile, isGithubEnabled } from './github';
import type { PublicUser } from './store';

const log = createLogger('auth-routes');

const COOKIE_NAME = 'sgs_session';

/** 认证端点独立限流:30 req/min/IP(登录/注册是暴力破解入口)。 */
const authRateLimit = createRateLimit(30);

function sanitizeUser(u: PublicUser): PublicUser {
  return u;
}

export function applyAuthRoutes(app: Hono): void {
  const auth = new Hono();
  auth.use('*', authRateLimit);

  const setSessionCookie = (c: Parameters<typeof setCookie>[0], token: string, expiresAt: number) => {
    setCookie(c, COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: c.req.url.startsWith('https://'),
      path: '/',
      maxAge: Math.floor((expiresAt - Date.now()) / 1000),
    });
  };

  // ── 注册 ──
  auth.post('/register', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof raw.username === 'string' ? raw.username : '';
    const password = typeof raw.password === 'string' ? raw.password : '';
    const result = await createUser(username, password);
    if (!result.ok) return c.json({ error: result.error }, 400);
    const session = await createSession(result.user.id);
    if (!session) return c.json({ error: '服务暂不可用' }, 503);
    setSessionCookie(c, session.token, session.expiresAt);
    return c.json({ user: sanitizeUser(result.user) });
  });

  // ── 登录(用户名/密码) ──
  auth.post('/login', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof raw.username === 'string' ? raw.username : '';
    const password = typeof raw.password === 'string' ? raw.password : '';
    const result = await verifyLogin(username, password);
    if (!result.ok) return c.json({ error: result.error }, 401);
    const session = await createSession(result.user.id);
    if (!session) return c.json({ error: '服务暂不可用' }, 503);
    setSessionCookie(c, session.token, session.expiresAt);
    return c.json({ user: sanitizeUser(result.user) });
  });

  // ── 当前用户 ──
  auth.get('/me', async (c) => {
    const user = await getUserByToken(getCookie(c, COOKIE_NAME));
    return c.json({ user, githubEnabled: isGithubEnabled() });
  });

  // ── 登出 ──
  auth.post('/logout', async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    await deleteSession(token);
    deleteCookie(c, COOKIE_NAME, { path: '/' });
    return c.json({ success: true });
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
