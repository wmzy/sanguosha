// src/client/pages/multiplayer/PasswordPromptDialog.tsx — 房间密码输入弹窗。
// mp.passwordPrompt 非空时由 LobbyStage 渲染;确认后经 mp.submitRoomPassword
// 携带密码重试加入(玩家/旁观按原方式),403 再次失败会带错误文案重新弹出。
import { useState } from 'react';
import { css } from '@linaria/core';
import { btnStyle, inputStyle, colors } from '../../theme';

const overlay = css`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const card = css`
  background: ${colors.bg.panel};
  border: 1px solid rgba(241, 196, 15, 0.35);
  border-radius: 12px;
  padding: 24px;
  width: 92%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const title = css`
  margin: 0;
  font-size: 17px;
  color: ${colors.accent.gold};
  display: flex;
  align-items: center;
  gap: 8px;
`;

const hint = css`
  font-size: 13px;
  color: ${colors.text.secondary};
`;

const errorText = css`
  font-size: 13px;
  color: ${colors.accent.red};
  min-height: 18px;
`;

const btnRow = css`
  display: flex;
  gap: 10px;
  justify-content: flex-end;
`;

export function PasswordPromptDialog({
  roomId,
  mode,
  error,
  onSubmit,
  onCancel,
}: {
  roomId: string;
  mode: 'join' | 'spectate';
  error: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');

  const submit = () => {
    if (!password.trim()) return;
    onSubmit(password);
  };

  return (
    <div className={overlay} role="dialog" aria-label="房间密码">
      <div className={card}>
        <h3 className={title}>🔒 该房间需要密码</h3>
        <p className={hint}>
          房间 {roomId} {mode === 'spectate' ? '开启了旁观密码保护' : '开启了密码保护'}，请输入密码加入。
        </p>
        <input
          className={inputStyle}
          type="password"
          placeholder="房间密码"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <div className={errorText} role={error ? 'alert' : undefined}>
          {error ?? ''}
        </div>
        <div className={btnRow}>
          <button className={btnStyle} onClick={onCancel}>
            取消
          </button>
          <button className={btnStyle} onClick={submit} disabled={!password.trim()}>
            加入
          </button>
        </div>
      </div>
    </div>
  );
}
