// src/client/pages/ProfilePage.tsx — 个人主页。
// 展示账号信息(昵称/用户名/登录方式),提供改名与修改密码。
// 昵称是房间内的展示名:改名后服务端实时广播 room_state 同步所有在线房间。
// 未登录直接跳回首页(该页面是登录用户专属)。
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { css } from '@linaria/core';
import { btnStyle, colors, inputStyle, pageStyle } from '../theme';
import { useAuth } from '../hooks/useAuth';

const page = css`
  /* 原此处插值 ${pageStyle}:wyw-in-js 不内联跨模块类属性,改为使用处 className 组合 */
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 40px 16px;
`;

const backLink = css`
  color: ${colors.text.secondary};
  font-size: 14px;
  text-decoration: none;
  align-self: flex-start;
  &:hover {
    color: ${colors.text.primary};
  }
`;

const card = css`
  background-color: ${colors.bg.panel};
  border: 1px solid ${colors.card.borderDefault};
  border-radius: 14px;
  padding: 28px;
  width: 100%;
  max-width: 420px;
`;

const header = css`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 22px;
`;

const avatar = css`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 1px solid ${colors.card.borderDefault};
  object-fit: cover;
`;

const avatarFallback = css`
  ${avatar}
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(241, 196, 15, 0.08);
  color: ${colors.accent.gold};
  font-size: 24px;
  font-weight: 600;
`;

const nameBlock = css`
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
`;

const displayName = css`
  font-size: 20px;
  font-weight: 700;
  color: ${colors.text.primary};
`;

const metaRow = css`
  font-size: 12px;
  color: ${colors.text.secondary};
`;

const section = css`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 18px;
  border-top: 1px solid ${colors.card.borderDefault};
  margin-top: 18px;
`;

const sectionTitle = css`
  font-size: 14px;
  font-weight: 600;
  color: ${colors.text.primary};
`;

const row = css`
  display: flex;
  gap: 8px;
`;

const hint = css`
  font-size: 12px;
  color: ${colors.text.muted};
`;

const errorText = css`
  color: ${colors.accent.red};
  font-size: 13px;
  min-height: 18px;
`;

const okText = css`
  color: ${colors.accent.green};
  font-size: 13px;
  min-height: 18px;
`;

export function ProfilePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [nameInput, setNameInput] = useState('');
  const [nameOk, setNameOk] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwOk, setPwOk] = useState(false);

  // 用户数据到达后回填昵称输入框
  useEffect(() => {
    if (auth.user) setNameInput(auth.user.displayName);
  }, [auth.user]);

  // 未登录(会话过期/直达 URL)回首页
  useEffect(() => {
    if (!auth.loading && !auth.user) navigate('/', { replace: true });
  }, [auth.loading, auth.user, navigate]);

  if (auth.loading || !auth.user) return null;
  const u = auth.user;

  const submitRename = async () => {
    const ok = await auth.rename(nameInput.trim());
    setNameOk(ok);
    if (ok) setTimeout(() => setNameOk(false), 2500);
  };

  const submitPassword = async () => {
    const ok = await auth.changePassword(oldPw, newPw);
    setPwOk(ok);
    if (ok) {
      setOldPw('');
      setNewPw('');
      setTimeout(() => setPwOk(false), 2500);
    }
  };

  return (
    <div className={`${pageStyle} ${page}`}>
      <Link to="/" className={backLink}>
        ← 返回首页
      </Link>
      <div className={card}>
        <div className={header}>
          {u.avatarUrl ? (
            <img className={avatar} src={u.avatarUrl} alt={u.displayName} />
          ) : (
            <div className={avatarFallback}>{u.displayName.slice(0, 1).toUpperCase()}</div>
          )}
          <div className={nameBlock}>
            <span className={displayName}>{u.displayName}</span>
            <span className={metaRow}>
              @{u.username} · {u.provider === 'github' ? 'GitHub 账号' : '本地账号'}
              {u.githubLinked ? ' · 已绑定 GitHub' : ''}
            </span>
          </div>
        </div>

        <div className={section}>
          <span className={sectionTitle}>昵称</span>
          <span className={hint}>房间内其他玩家看到的名称。修改后即时生效。</span>
          <div className={row}>
            <input
              className={inputStyle}
              value={nameInput}
              maxLength={24}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitRename()}
              placeholder="输入新昵称"
            />
            <button
              className={btnStyle}
              disabled={!nameInput.trim() || nameInput.trim() === u.displayName}
              onClick={() => void submitRename()}
            >
              保存
            </button>
          </div>
          {nameOk && <span className={okText}>已保存</span>}
        </div>

        {u.hasPassword && (
          <div className={section}>
            <span className={sectionTitle}>修改密码</span>
            <input
              className={inputStyle}
              type="password"
              autoComplete="current-password"
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
              placeholder="当前密码"
            />
            <input
              className={inputStyle}
              type="password"
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitPassword()}
              placeholder="新密码（至少 6 位）"
            />
            <button
              className={btnStyle}
              disabled={!oldPw || newPw.length < 6}
              onClick={() => void submitPassword()}
            >
              修改密码
            </button>
            {pwOk && <span className={okText}>密码已更新</span>}
          </div>
        )}

        <div className={section}>
          <div className={errorText} role={auth.error ? 'alert' : undefined}>
            {auth.error ?? ''}
          </div>
          <button className={btnStyle} onClick={() => void auth.logout()}>
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
