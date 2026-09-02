// src/client/pages/multiplayer/LobbyStage.tsx
// lobby 阶段:顶栏 + 创建/加入/旁观三表单 + 房间列表(RoomListPanel)。
// 表单 state、房间列表拉取/删除、创建/加入/旁观 handler 全部收在本组件;房间数据走 MultiplayerRoomCtx。
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css, cx } from '@linaria/core';
import { RoomListPanel } from '../../components/RoomListPanel';
import { apiFetch, ApiError } from '../../api/client';
import { inputStyle } from '../../theme';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';
import { PasswordPromptDialog } from './PasswordPromptDialog';
import { ErrorToast } from './ErrorToast';
import {
  title,
  subtitle,
  card,
  sectionTitle,
  formRow,
  label,
  divider,
  lobbyPage,
  topBar,
  topBarBtn,
  topBarTag,
  lobbyLayout,
  lobbyMain,
  lobbySide,
  GAME_MODE_OPTIONS,
} from './multiplayerStyles';
import type { RoomInfo, RoomConfig } from '../../../server/protocol';
import type { GameMode } from '../../../engine/rules/types';

/* ── 表单主按钮:与全站幽灵药丸体系同语言 ── */
const formBtn = css`
  border: 1px solid rgba(217, 180, 92, 0.55);
  border-radius: 999px;
  padding: 10px 18px;
  cursor: pointer;
  background: linear-gradient(rgba(240, 178, 60, 0.94), rgba(206, 138, 30, 0.94));
  color: #2b1c05;
  font-size: 14px;
  font-weight: bold;
  letter-spacing: 1px;
  width: 100%;
  box-shadow:
    inset 0 1px 0 rgba(255, 240, 200, 0.3),
    0 4px 14px rgba(206, 138, 30, 0.32);
  transition: all 0.15s;
  &:hover {
    filter: brightness(1.07);
    transform: translateY(-1px);
  }
  &:disabled {
    opacity: 0.55;
    cursor: wait;
    transform: none;
  }
`;
const formBtnGhost = css`
  border-color: rgba(82, 150, 220, 0.55);
  background: rgba(52, 120, 200, 0.12);
  color: #7db8e8;
  font-weight: normal;
  letter-spacing: 0.5px;
  box-shadow: none;
  &:hover {
    border-color: rgba(120, 180, 240, 0.8);
    background: rgba(52, 120, 200, 0.22);
    filter: none;
    transform: translateY(-1px);
  }
`;

export function LobbyStage() {
  const mp = useMultiplayerRoomCtx();
  const navigate = useNavigate();

  // lobby 阶段表单状态
  const [createName, setCreateName] = useState('');
  const [createMax, setCreateMax] = useState(2);
  const [createRoomType, setCreateRoomType] = useState<'quick' | 'normal'>('quick');
  const [createGameMode, setCreateGameMode] = useState<GameMode>('身份局');
  const [createPassword, setCreatePassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [spectateCode, setSpectateCode] = useState('');

  // lobby 阶段房间列表(参考 DebugLobby)
  const [rooms, setRooms] = useState<RoomInfo[]>([]);

  const fetchRooms = useCallback(async () => {
    try {
      const list = await apiFetch<RoomInfo[]>('/api/rooms?type=multiplayer');
      setRooms(list);
    } catch (err) {
      // 静默失败，不干扰用户主流程
      if (err instanceof ApiError) {
        console.warn('获取房间列表失败', err.status, err.body);
      }
    }
  }, []);

  // 进入 lobby 时加载房间列表
  useEffect(() => {
    void fetchRooms();
  }, [fetchRooms]);

  // 删除房间(参考 DebugLobby 的 handleDeleteDebugRoom)
  const handleDeleteRoom = useCallback(
    (roomId: string) => {
      apiFetch<void>(`/api/rooms/${roomId}`, { method: 'DELETE' })
        .then(() => fetchRooms())
        .catch((err) => {
          if (err instanceof ApiError) {
            console.warn('删除房间失败', err.status, err.body);
          }
        });
    },
    [fetchRooms],
  );

  const handleCreate = () => {
    // 1v1 固定两人;身份局沿用所选人数。config 传部分字段,服务端 normalizeRoomConfig 补全。
    const max = createGameMode === '1v1' ? 2 : createMax;
    const password = createPassword.trim();
    mp.createRoom(createName.trim(), max, { gameMode: createGameMode } as unknown as RoomConfig, createRoomType, password || undefined);
  };

  const handleJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 1) return;
    mp.joinRoom(code);
  };

  const handleSpectate = () => {
    const code = spectateCode.trim().toUpperCase();
    if (code.length < 1) return;
    mp.joinAsSpectator(code);
  };

  return (
    <div className={lobbyPage}>
      {/* 顶栏:返回首页常驻页面顶部(滚动跟随) */}
      <header className={topBar}>
        <button className={topBarBtn} onClick={() => navigate('/')}>
          ← 返回首页
        </button>
        <span className={topBarTag}>多人对战</span>
      </header>
      <div className={lobbyLayout}>
        <div className={lobbyMain}>
          <h1 className={title}>多人游戏</h1>
          <p className={subtitle}>创建房间或选择房间加入</p>
          <div className={card}>
          <div className={sectionTitle}>创建房间</div>
          <div className={formRow}>
            <label className={label}>房间名（可选）</label>
            <input
              className={inputStyle}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="自动生成房间名"
            />
            <label className={label}>房间类型</label>
            <select
              className={inputStyle}
              value={createRoomType}
              onChange={(e) => setCreateRoomType(e.target.value as 'quick' | 'normal')}
            >
              <option value="quick">快速房间（人走自动销毁）</option>
              <option value="normal">普通房间（持久保留）</option>
            </select>
            <label className={label}>游戏模式</label>
            <select
              className={inputStyle}
              value={createGameMode}
              onChange={(e) => setCreateGameMode(e.target.value as GameMode)}
            >
              {GAME_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {createGameMode === '身份局' && (
              <>
                <label className={label}>玩家人数（2-8）</label>
                <input
                  className={inputStyle}
                  type="number"
                  min={2}
                  max={8}
                  value={createMax}
                  onChange={(e) => setCreateMax(Number(e.target.value) || 0)}
                  onBlur={() => setCreateMax(Math.min(Math.max(createMax || 2, 2), 8))}
                />
              </>
            )}
            <label className={label}>房间密码（可选，留空不设密码）</label>
            <input
              className={inputStyle}
              type="password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              placeholder="最多 32 位"
              maxLength={32}
            />
            <button className={formBtn} onClick={handleCreate} disabled={mp.isCreating}>
              {mp.isCreating ? '创建中…' : '创建房间'}
            </button>
          </div>
          <div className={divider} />
          <div className={sectionTitle}>加入房间</div>
          <div className={formRow}>
            <label className={label}>房间码</label>
            <input
              className={inputStyle}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="输入6位房间码"
              maxLength={8}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleJoin();
              }}
            />
            <button className={cx(formBtn, formBtnGhost)} onClick={handleJoin}>
              加入房间
            </button>
          </div>
          <div className={divider} />
          <div className={sectionTitle}>旁观房间</div>
          <div className={formRow}>
            <label className={label}>房间码（以旁观者身份加入）</label>
            <input
              className={inputStyle}
              value={spectateCode}
              onChange={(e) => setSpectateCode(e.target.value.toUpperCase())}
              placeholder="输入6位房间码"
              maxLength={8}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSpectate();
              }}
            />
            <button className={cx(formBtn, formBtnGhost)} onClick={handleSpectate}>
              👁 旁观加入
            </button>
          </div>
          </div>
        </div>
        <aside className={lobbySide}>
          <RoomListPanel
            rooms={rooms}
            onRefresh={fetchRooms}
            onJoin={mp.joinRoom}
            onDelete={handleDeleteRoom}
            onSpectate={mp.joinAsSpectator}
            emptyText="暂无公开房间"
            currentPlayerId={mp.playerId}
          />
        </aside>
      </div>
      {mp.error && <ErrorToast message={mp.error} onClose={mp.clearError} />}
      {mp.passwordPrompt && (
        <PasswordPromptDialog
          roomId={mp.passwordPrompt.roomId}
          mode={mp.passwordPrompt.mode}
          error={mp.passwordPrompt.error ?? null}
          onSubmit={mp.submitRoomPassword}
          onCancel={mp.cancelRoomPassword}
        />
      )}
    </div>
  );
}
