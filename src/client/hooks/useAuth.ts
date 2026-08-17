// src/client/hooks/useAuth.ts — 登录态管理 hook。
// 会话由服务端 HttpOnly Cookie 携带,客户端只保存 PublicUser 派生信息。
// 登录/注册/GitHub 登录/登出/自动恢复(me);GitHub 入口是否可用由 /me 的
// githubEnabled 随状态返回(服务端未配置凭据时隐藏按钮)。
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { setPlayerId, getPlayerId } from '../utils/playerIdentity';
import { createLogger } from '../utils/logger';

const log = createLogger('useAuth');

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  provider: string;
  hasPassword: boolean;
  githubLinked: boolean;
}

type MeResponse = { user: AuthUser | null; githubEnabled: boolean };

export interface AuthState {
  user: AuthUser | null;
  /** 服务端是否配置了 GitHub OAuth 凭据 */
  githubEnabled: boolean;
  /** 初始 /me 探测中 */
  loading: boolean;
  /** 登录/注册请求进行中 */
  submitting: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // StrictMode 安全:cleanup 不置全局 ref=false(双执行时第二个 effect 的异步回调
  // 会被第一个 cleanup 永久禁言)。用 effect 局部 active 标志,随每次 effect 实例独立。
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const me = await apiFetch<MeResponse>('/api/auth/me');
        if (!active) return;
        setUser(me.user);
        setGithubEnabled(me.githubEnabled);
        // 登录态恢复时同步昵称(未手动设置过 playerId 的场景)
        if (me.user && !getPlayerId()) setPlayerId(me.user.displayName);
      } catch {
        /* 未登录属正常 */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const submitAuth = useCallback(async (
    path: 'login' | 'register',
    username: string,
    password: string,
  ): Promise<boolean> => {
    setError(null);
    setSubmitting(true);
    try {
      const resp = await apiFetch<{ user: AuthUser }>(`/api/auth/${  path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      // 组件卸载后的 setState 在 React 18+ 是无害 no-op,无需 mounted 守卫
      setUser(resp.user);
      setPlayerId(resp.user.displayName);
      return true;
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      const msg = body?.error ?? (path === 'login' ? '登录失败' : '注册失败');
      setError(msg);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const login = useCallback(
    (username: string, password: string) => submitAuth('login', username, password),
    [submitAuth],
  );

  const register = useCallback(
    (username: string, password: string) => submitAuth('register', username, password),
    [submitAuth],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      log.warn('logout failed', { error: String(err) });
    }
    setUser(null);
    setError(null);
  }, []);

  return { user, githubEnabled, loading, submitting, error, login, register, logout };
}
