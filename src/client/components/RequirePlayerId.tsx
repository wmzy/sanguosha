// src/client/components/RequirePlayerId.tsx — 玩家身份门禁
//
// 无登录系统:进入房间前必须设置一个昵称(playerId)。
// 本组件包裹需要身份的页面(/play、/debug),未设置身份时显示设置表单,
// 设置后渲染子页面。身份持久化到 localStorage(见 playerIdentity.ts)。
import { useState, type ReactNode } from 'react';
import { css } from '@linaria/core';
import { colors, inputStyle, btnStyle, pageStyle } from '../theme';
import { getPlayerId, setPlayerId } from '../utils/playerIdentity';

const overlay = css`
  ${pageStyle}
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
`;

const card = css`
  background-color: ${colors.bg.panel};
  border-radius: 12px;
  padding: 32px;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  text-align: center;
`;

const heading = css`
  font-size: 22px;
  margin: 0 0 8px;
  color: ${colors.accent.gold};
  letter-spacing: 2px;
`;

const hint = css`
  font-size: 13px;
  color: ${colors.text.muted};
  margin: 0 0 24px;
  line-height: 1.5;
`;

const formRow = css`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const submitBtn = css`
  ${btnStyle}
  --btn-bg: ${colors.accent.blue};
  --btn-padding: 12px 24px;
`;

/** 玩家身份输入表单(门禁与「修改身份」共用)。 */
export function PlayerIdForm({
  initial,
  submitLabel,
  onSet,
}: {
  initial?: string;
  submitLabel: string;
  onSet: (id: string) => void;
}) {
  const [value, setValue] = useState(initial ?? '');
  const trimmed = value.trim();
  const submit = () => {
    if (trimmed) onSet(trimmed);
  };
  return (
    <div className={formRow}>
      <input
        className={inputStyle}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="输入昵称"
        maxLength={20}
        autoFocus
      />
      <button className={submitBtn} onClick={submit} disabled={!trimmed}>
        {submitLabel}
      </button>
    </div>
  );
}

/**
 * 身份门禁:已设置身份时渲染 children,否则显示设置表单。
 * 用于包裹需要身份的路由页面,确保 hook 在身份就绪后才挂载。
 */
export function RequirePlayerId({ children }: { children: ReactNode }) {
  const [pid, setPid] = useState<string | null>(() => getPlayerId());
  if (pid) return <>{children}</>;
  return (
    <div className={overlay}>
      <div className={card}>
        <h2 className={heading}>设置身份</h2>
        <p className={hint}>
          进入房间前需要一个昵称作为你的玩家身份。
          <br />
          无需登录,关闭后仍记住。
        </p>
        <PlayerIdForm
          submitLabel="确认进入"
          onSet={(id) => {
            setPlayerId(id);
            setPid(id);
          }}
        />
      </div>
    </div>
  );
}
