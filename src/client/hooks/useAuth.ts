// src/client/hooks/useAuth.ts — 登录态管理 hook。
// 会话由服务端 HttpOnly Cookie 携带,客户端只保存 PublicUser 派生信息。
// 登录/注册/GitHub 登录/登出/自动恢复(me)/改名/改密。
// GitHub 入口是否可用由 /me 的 githubEnabled 随状态返回(服务端未配置凭据时隐藏按钮)。
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
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
  /** 修改昵称(个人页);成功后房间内显示名由服务端实时广播同步 */
  rename: (displayName: string) => Promise<boolean>;
  /** 修改密码(个人页);旧密码校验在服务端 */
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>;
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
    (async () => {
      try {
        const resp = await apiFetch<MeResponse>('/api/auth/me');
        if (!active) return;
        setUser(resp.user);
        setGithubEnabled(resp.githubEnabled);
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
    setSubmitting(true);
    setError(null);
    try {
      const resp = await apiFetch<{ user: AuthUser }>(`/api/auth/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      setUser(resp.user);
      return true;
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      setError(body?.error ?? '请求失败，请稍后重试');
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
      log.error('logout failed', { error: String(err) });
    }
    setUser(null);
    setError(null);
  }, []);

  const rename = useCallback(async (displayName: string): Promise<boolean> => {
    setError(null);
    try {
      const resp = await apiFetch<{ user: AuthUser }>('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      setUser(resp.user);
      return true;
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      setError(body?.error ?? '修改失败，请稍后重试');
      return false;
    }
  }, []);

  const changePassword = useCallback(async (
    oldPassword: string,
    newPassword: string,
  ): Promise<boolean> => {
    setError(null);
    try {
      await apiFetch<{ user: AuthUser }>('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      return true;
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      setError(body?.error ?? '修改失败，请稍后重试');
      return false;
    }
  }, []);

  return {
    user,
    githubEnabled,
    loading,
    submitting,
    error,
    login,
    register,
    logout,
    rename,
    changePassword,
  };
}
