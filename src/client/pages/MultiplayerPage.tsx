// src/client/pages/MultiplayerPage.tsx
// 多人游戏入口页。最小加入页：创建/加入房间 → 等待大厅 → 对局 → 结算。
// 复用单视角 GameViewComponent 渲染玩家自己的座次。
import { useState, useEffect } from 'react';
import { css } from '@linaria/core';
import { useNavigate, useParams } from 'react-router-dom';
import { useMultiplayerRoom } from '../hooks/useMultiplayerRoom';
import { GameViewComponent } from '../components/GameView';
import { colors, pageStyle, btnStyle, inputStyle, errorToastStyle } from '../theme';
import type { ActionMsg } from '../types';

const page = css`
  ${pageStyle}
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  padding: 40px 20px;
`;

const title = css`
  font-size: 36px;
  margin: 0 0 8px;
  letter-spacing: 4px;
  color: ${colors.accent.gold};
`;

const subtitle = css`
  color: ${colors.text.muted};
  margin: 0 0 32px;
`;

const card = css`
  background-color: ${colors.bg.panel};
  border-radius: 12px;
  padding: 28px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
`;

const sectionTitle = css`
  font-size: 18px;
  font-weight: bold;
  margin: 0 0 16px;
  color: ${colors.text.primary};
`;

const formRow = css`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
`;

const label = css`
  font-size: 13px;
  color: ${colors.text.secondary};
`;

const divider = css`
  border-top: 1px solid #3a4a5e;
  margin: 24px 0;
`;

const roomCodeBox = css`
  background-color: ${colors.bg.input};
  border: 2px dashed ${colors.accent.gold};
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  margin-bottom: 20px;
`;

const roomCodeLabel = css`
  font-size: 12px;
  color: ${colors.text.muted};
  margin-bottom: 6px;
`;

const roomCode = css`
  font-size: 32px;
  font-weight: bold;
  letter-spacing: 6px;
  color: ${colors.accent.gold};
  font-family: monospace;
`;

const readyInfo = css`
  text-align: center;
  margin-bottom: 20px;
  font-size: 15px;
  color: ${colors.text.secondary};
`;

const buttonRow = css`
  display: flex;
  gap: 12px;
  justify-content: center;
`;

const gameOverBox = css`
  ${card}
  text-align: center;
`;

const winnerText = css`
  font-size: 28px;
  font-weight: bold;
  margin: 16px 0;
  color: ${colors.accent.gold};
`;

export function MultiplayerPage() {
  const navigate = useNavigate();
  const { roomId: urlRoomId } = useParams<{ roomId?: string }>();
  const mp = useMultiplayerRoom(urlRoomId);

  // lobby 阶段表单状态
  const [createName, setCreateName] = useState('');
  const [createMax, setCreateMax] = useState(2);
  const [joinCode, setJoinCode] = useState('');

  // 房间码进入 URL:建房/加入后同步到 /play/:roomId,便于分享直达
  useEffect(() => {
    if (mp.roomId && mp.roomId !== urlRoomId) {
      navigate(`/play/${mp.roomId}`, { replace: true });
    }
  }, [mp.roomId, urlRoomId, navigate]);

  const handleCreate = () => {
    mp.createRoom(createName.trim(), createMax);
  };

  const handleJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 1) return;
    mp.joinRoom(code);
  };

  const allReady = mp.roomState && mp.roomState.readyPlayers.length === mp.roomState.playerIds.length && mp.roomState.playerIds.length >= 2;
  const readyCount = mp.roomState?.readyPlayers.length ?? 0;
  const playerCount = mp.roomState?.playerIds.length ?? 0;
  const maxPlayers = mp.roomState?.maxPlayers ?? createMax;

  const handleAction = (action: ActionMsg) => mp.sendAction(action);

  if (mp.stage === 'playing' && mp.view) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: colors.bg.page }}>
        <GameViewComponent view={mp.view} onAction={handleAction} onReorderHand={mp.reorderHand} />
      </div>
    );
  }

  if (mp.stage === 'ended' || mp.gameOver) {
    return (
      <div className={page}>
        <h1 className={title}>游戏结束</h1>
        <div className={gameOverBox}>
          <p className={winnerText}>
            {mp.gameOver?.winner === '无人' ? '平局' : `胜方：${mp.gameOver?.winner ?? '未知'}`}
          </p>
          <div className={buttonRow}>
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.green } as React.CSSProperties}
              onClick={mp.sendRestart}
            >
              再来一局
            </button>
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.blue } as React.CSSProperties}
              onClick={() => { mp.leaveRoom(); navigate('/'); }}
            >
              返回大厅
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mp.stage === 'waiting') {
    return (
      <div className={page}>
        <h1 className={title}>等待大厅</h1>
        <p className={subtitle}>等待玩家加入并准备</p>
        <div className={card}>
          <div className={roomCodeBox}>
            <div className={roomCodeLabel}>房间码（分享给其他玩家）</div>
            <div className={roomCode}>{mp.roomId ?? '加载中…'}</div>
          </div>
          <div className={readyInfo}>
            已就绪：{readyCount} / {playerCount}（满 {maxPlayers} 人）
          </div>
          <div className={buttonRow}>
            {!mp.ready && (
              <button
                className={btnStyle}
                style={{ '--btn-bg': colors.accent.green } as React.CSSProperties}
                onClick={mp.toggleReady}
              >
                准备
              </button>
            )}
            {mp.ready && (
              <span style={{ color: colors.accent.green, fontWeight: 'bold' }}>已准备 ✓</span>
            )}
            {mp.isHost && (
              <button
                className={btnStyle}
                style={{ '--btn-bg': allReady ? colors.accent.orange : colors.disabled, '--btn-cursor': allReady ? 'pointer' : 'not-allowed' } as React.CSSProperties}
                disabled={!allReady}
                onClick={mp.startGame}
              >
                开始游戏
              </button>
            )}
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.disabled } as React.CSSProperties}
              onClick={() => { mp.leaveRoom(); navigate('/'); }}
            >
              退出
            </button>
          </div>
        </div>
        {mp.error && <div className={errorToastStyle}>{mp.error}</div>}
      </div>
    );
  }

  // lobby 阶段
  return (
    <div className={page}>
      <h1 className={title}>多人游戏</h1>
      <p className={subtitle}>创建房间或输入房间码加入</p>
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
          <label className={label}>玩家人数（2-8）</label>
          <input
            className={inputStyle}
            type="number"
            min={2}
            max={8}
            value={createMax}
            onChange={(e) => setCreateMax(Math.min(Math.max(Number(e.target.value) || 2, 2), 8))}
          />
          <button
            className={btnStyle}
            style={{ '--btn-bg': colors.accent.orange } as React.CSSProperties}
            onClick={handleCreate}
          >
            创建房间
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
            onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
          />
          <button
            className={btnStyle}
            style={{ '--btn-bg': colors.accent.blue } as React.CSSProperties}
            onClick={handleJoin}
          >
            加入房间
          </button>
        </div>
        <div className={buttonRow} style={{ marginTop: 8 }}>
          <button
            className={btnStyle}
            style={{ '--btn-bg': colors.disabled } as React.CSSProperties}
            onClick={() => navigate('/')}
          >
            返回首页
          </button>
        </div>
      </div>
      {mp.error && <div className={errorToastStyle}>{mp.error}</div>}
    </div>
  );
}
