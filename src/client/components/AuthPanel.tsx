// src/client/components/AuthPanel.tsx — 登录/认证面板。
// 三种形态:已登录(头像+昵称+登出)、未登录表单(登录/注册 tab + GitHub 按钮)。
// GitHub 登录 = 整页跳转 /api/auth/github,回调由服务端 redirect 回首页。
import { memo, useState } from 'react';
import { css } from '@linaria/core';
import { btnStyle, inputStyle, colors } from '../theme';
import type { AuthState } from '../hooks/useAuth';

const panel = css`
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 340px;
`;

const tabRow = css`
  display: flex;
  gap: 0;
  border: 1px solid ${colors.card.borderDefault};
  border-radius: 8px;
  overflow: hidden;
`;

const tab = css`
  flex: 1;
  padding: 8px 0;
  text-align: center;
  background: transparent;
  border: none;
  color: ${colors.text.secondary};
  cursor: pointer;
  font-size: 14px;
  &:hover {
    color: ${colors.text.primary};
  }
`;

const tabActive = css`
  background: ${colors.bg.panel};
  color: ${colors.text.primary};
  font-weight: 600;
`;

const githubBtn = css`
  /* 原此处插值 ${btnStyle}:wyw-in-js 不内联跨模块类属性;本类自带全部所需属性
     (含 btnStyle 的 font-weight: bold) */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #24292f;
  color: #fff;
  border: none;
  padding: 9px 16px;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  border-radius: 8px;
  &:hover {
    background: #32383f;
  }
`;

const loggedInRow = css`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const avatar = css`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid ${colors.card.borderDefault};
  object-fit: cover;
`;

/** 头像加载失败时的首字母回退块。
 *  原 css`` 内插值同文件 ${avatar}:wyw 不内联类规则,首条非法声明还会吞掉
 *  display:flex,avatar 的 40px 宽高/圆角/边框全部丢失——故直接内联全部所需属性。 */
const avatarFallback = css`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid ${colors.card.borderDefault};
  background: ${colors.bg.panel};
  color: ${colors.accent.gold};
  font-size: 18px;
  font-weight: 600;
`;

const userInfo = css`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const userName = css`
  color: ${colors.text.primary};
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const userMeta = css`
  color: ${colors.text.secondary};
  font-size: 12px;
`;

const profileLink = css`
  color: ${colors.accent.blue};
  font-size: 13px;
  text-decoration: none;
  white-space: nowrap;
  &:hover {
    text-decoration: underline;
  }
`;

const errorText = css`
  color: ${colors.accent.red};
  font-size: 13px;
  min-height: 18px;
`;

const divider = css`
  display: flex;
  align-items: center;
  gap: 10px;
  color: ${colors.text.secondary};
  font-size: 12px;
  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: ${colors.card.borderDefault};
  }
`;

export const AuthPanel = memo(({ auth, compact = false }: { auth: AuthState; compact?: boolean }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (auth.loading) {
    return <div className={panel} aria-busy="true">…</div>;
  }

  if (auth.user) {
    return (
      <div className={panel}>
        <div className={loggedInRow}>
          {auth.user.avatarUrl ? (
            <img className={avatar} src={auth.user.avatarUrl} alt={auth.user.displayName} />
          ) : (
            <div className={avatarFallback}>{auth.user.displayName.slice(0, 1).toUpperCase()}</div>
          )}
          <div className={userInfo}>
            <span className={userName}>{auth.user.displayName}</span>
            <span className={userMeta}>
              @{auth.user.username}
              {auth.user.githubLinked ? ' · GitHub 已绑定' : ''}
            </span>
          </div>
          <a className={profileLink} href="/profile">
            个人主页
          </a>
          <button className={btnStyle} onClick={() => void auth.logout()}>
            退出
          </button>
        </div>
        {!compact && <div className={errorText}>{auth.error ?? ''}</div>}
      </div>
    );
  }

  const submit = () => {
    const fn = mode === 'login' ? auth.login : auth.register;
    void fn(username.trim(), password);
  };

  return (
    <div className={panel}>
      <div className={tabRow}>
        <button
          className={mode === 'login' ? `${tab} ${tabActive}` : tab}
          onClick={() => setMode('login')}
        >
          登录
        </button>
        <button
          className={mode === 'register' ? `${tab} ${tabActive}` : tab}
          onClick={() => setMode('register')}
        >
          注册
        </button>
      </div>
      <input
        className={inputStyle}
        placeholder="用户名"
        value={username}
        autoComplete="username"
        onChange={(e) => setUsername(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <input
        className={inputStyle}
        placeholder={mode === 'login' ? '密码' : '密码（至少 6 位）'}
        type="password"
        value={password}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div className={errorText} role={auth.error ? 'alert' : undefined}>
        {auth.error ?? ''}
      </div>
      <button className={btnStyle} disabled={auth.submitting} onClick={submit}>
        {mode === 'login' ? '登录' : '注册并登录'}
      </button>
      {auth.githubEnabled && (
        <>
          <div className={divider}>或</div>
          <a className={githubBtn} href="/api/auth/github">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            使用 GitHub 登录
          </a>
        </>
      )}
    </div>
  );
});
