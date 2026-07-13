// src/client/pages/MultiplayerPage.tsx
// 多人游戏入口页。最小加入页：创建/加入房间 → 等待大厅 → 对局 → 结算。
// 复用单视角 GameViewComponent 渲染玩家自己的座次。
// lobby 阶段展示房间列表(参考 DebugLobby 的 RoomListPanel)。
import { useState, useEffect, useCallback } from 'react';
import { css } from '@linaria/core';
import { useNavigate, useParams } from 'react-router-dom';
import { useMultiplayerRoom } from '../hooks/useMultiplayerRoom';
import { GameViewComponent } from '../components/GameView';
import { RoomListPanel } from '../components/RoomListPanel';
import { ChatPanel } from '../components/ChatPanel';
import { ChatConfigSection } from '../components/ChatConfigSection';
import { colors, pageStyle, btnStyle, inputStyle, errorToastStyle } from '../theme';
import { saveReplay } from '../replay/replayFile';
import { apiFetch, ApiError } from '../api/client';
import type { ReplayMeta } from '../replay/types';
import type { ActionMsg } from '../types';
import type { RoomInfo } from '../../server/protocol';

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

const configGrid = css`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 24px;
  background-color: ${colors.bg.input};
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 20px;
  font-size: 13px;
`;

const configItem = css`
  display: flex;
  justify-content: space-between;
  gap: 8px;
`;

const configKey = css`
  color: ${colors.text.muted};
`;

const configVal = css`
  color: ${colors.text.primary};
  font-weight: bold;
`;

const POOL_LABELS: Record<string, string> = {
  standard: '标准池 (~32人)',
  extended: '扩展池',
  all: '全武将 (60人)',
};

function timeoutLabel(v: number): string {
  if (!Number.isFinite(v)) return '无限';
  if (v <= 0.7) return `快 (${v}×)`;
  if (v === 1) return `标准 (${v}×)`;
  return `慢 (${v}×)`;
}

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

const gameWrap = css`
  min-height: 100vh;
  background-color: ${colors.bg.page};
`;

const lobbyRow = css`
  display: flex;
  gap: 24px;
  align-items: flex-start;
  flex-wrap: wrap;
  justify-content: center;
`;

const returnHomeRow = css`
  ${buttonRow}
  margin-top: 8px;
`;

/** 重连提示覆盖层(非阻塞,固定顶部) */
const reconnectOverlay = css`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: bold;
  color: #fff;
  pointer-events: auto;
  background-color: ${colors.accent.amber};
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
`;

const reconnectFailedOverlay = css`
  ${reconnectOverlay}
  background-color: ${colors.accent.red};
`;

const reconnectSpinner = css`
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const notFoundPage = css`
  ${pageStyle}
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  text-align: center;
  gap: 12px;
`;

const notFoundCode = css`
  font-size: 96px;
  font-weight: bold;
  color: ${colors.accent.red};
  line-height: 1;
  letter-spacing: 4px;
`;

const notFoundTitle = css`
  font-size: 24px;
  font-weight: bold;
  color: ${colors.text.primary};
`;

const notFoundDesc = css`
  font-size: 15px;
  color: ${colors.text.secondary};
  max-width: 400px;
`;

const notFoundRoomId = css`
  font-family: monospace;
  color: ${colors.accent.gold};
  font-weight: bold;
  letter-spacing: 2px;
`;

export function MultiplayerPage() {
  const navigate = useNavigate();
  const { roomId: urlRoomId } = useParams<{ roomId?: string }>();
  const mp = useMultiplayerRoom(urlRoomId);

  const handleDownloadReplay = useCallback(() => {
    if (!mp.recorder.hasData() || !mp.view) return;
    const characters = mp.view.players.map((p) => p.character || '');
    const meta: ReplayMeta = {
      createdAt: Date.now(),
      playerCount: mp.view.players.length,
      characters,
      roomName: mp.roomId ?? undefined,
    };
    const file = mp.recorder.finalize(meta);
    saveReplay(file);
  }, [mp]);

  // lobby 阶段表单状态
  const [createName, setCreateName] = useState('');
  const [createMax, setCreateMax] = useState(2);
  const [createRoomType, setCreateRoomType] = useState<'quick' | 'normal'>('quick');
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

  // 房间码进入 URL:建房/加入后同步到 /play/:roomId,便于分享直达
  useEffect(() => {
    if (mp.roomId && mp.roomId !== urlRoomId) {
      navigate(`/play/${mp.roomId}`, { replace: true });
    }
  }, [mp.roomId, urlRoomId, navigate]);

  const handleCreate = () => {
    mp.createRoom(createName.trim(), createMax, undefined, createRoomType);
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

  const allReady =
    mp.roomState &&
    mp.roomState.readyPlayers.length === mp.roomState.playerIds.length &&
    mp.roomState.playerIds.length >= 2;
  const readyCount = mp.roomState?.readyPlayers.length ?? 0;
  const playerCount = mp.roomState?.playerIds.length ?? 0;
  const maxPlayers = mp.roomState?.maxPlayers ?? createMax;
  const spectatorCount = mp.roomState?.spectatorIds.length ?? 0;
  const pendingRequests = mp.roomState?.pendingViewRequests ?? {};

  const handleAction = (action: ActionMsg) => mp.sendAction(action);

  // 重连提示覆盖层(非阻塞:显示在内容之上,不阻止渲染)
  const reconnectBanner =
    mp.connectionState === 'reconnecting' ? (
      <div className={reconnectOverlay}>
        <span className={reconnectSpinner} />
        <span>
          正在重连… (第 {mp.reconnectAttempt} 次)
        </span>
        <button
          className={btnStyle}
          style={{
            '--btn-bg': colors.accent.darkRed,
            '--btn-padding': '4px 12px',
            '--btn-font-size': '12px',
          } as React.CSSProperties}
          onClick={mp.cancelReconnect}
        >
          取消
        </button>
      </div>
    ) : mp.connectionState === 'failed' ? (
      <div className={reconnectFailedOverlay}>
        <span>重连失败,请检查网络</span>
        <button
          className={btnStyle}
          style={{
            '--btn-bg': colors.accent.darkRed,
            '--btn-padding': '4px 12px',
            '--btn-font-size': '12px',
          } as React.CSSProperties}
          onClick={() => {
            mp.leaveRoom();
            navigate('/');
          }}
        >
          返回大厅
        </button>
      </div>
    ) : null;

  // 房间不存在(URL 直达不存在的 roomId):显示 404 页面
  if (mp.notFound) {
    return (
      <div className={notFoundPage}>
        <div className={notFoundCode}>404</div>
        <div className={notFoundTitle}>房间不存在</div>
        <p className={notFoundDesc}>
          房间码 <span className={notFoundRoomId}>{urlRoomId}</span> 对应的房间可能已被关闭或从未创建。
        </p>
        <div className={buttonRow}>
          <button
            className={btnStyle}
            style={{ '--btn-bg': colors.accent.orange } as React.CSSProperties}
            onClick={() => {
              mp.leaveRoom();
              navigate('/play');
            }}
          >
            进入大厅
          </button>
          <button
            className={btnStyle}
            style={{ '--btn-bg': colors.disabled } as React.CSSProperties}
            onClick={() => navigate('/')}
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  if (mp.stage === 'spectating' && mp.view) {
    // 旁观者申请查看某玩家视角的下拉
    const spectatorList = mp.roomState?.spectatorIds ?? [];
    const viewGrants = mp.roomState?.viewGrants ?? {};
    const pendingRequests = mp.roomState?.pendingViewRequests ?? {};
    const myGrant = mp.playerId ? viewGrants[mp.playerId] : undefined;
    // 构建玩家名称列表（座次序号 → playerId）
    const playerIds = mp.roomState?.playerIds ?? [];
    return (
      <>
        {reconnectBanner}
        <div className={gameWrap}>
          {/* 旁观者控制条 */}
          <div style={{ padding: '8px 16px', background: colors.bg.panel, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: colors.accent.gold, fontWeight: 'bold' }}>👁 旁观中</span>
            <span style={{ color: colors.text.muted, fontSize: '13px' }}>
              {myGrant !== undefined ? `已授权查看 P${myGrant} 视角` : '公开视图'}
            </span>
            {/* 申请查看下拉 */}
            {myGrant === undefined && (
              <>
                <select
                  className={inputStyle}
                  style={{ width: 'auto', fontSize: '13px' }}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value && mp.playerId) {
                      // 只发送申请，不直接切换
                      const seat = Number(e.target.value);
                      mp.requestView(seat);
                      e.target.value = '';
                    }
                  }}
                >
                  <option value="" disabled>申请查看视角…</option>
                  {playerIds.map((pid, i) => (
                    <option key={pid} value={i}>P{i} {pid.slice(0, 6)}</option>
                  ))}
                </select>
              </>
            )}
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.disabled, '--btn-padding': '4px 12px', '--btn-font-size': '12px' } as React.CSSProperties}
              onClick={() => {
                mp.leaveRoom();
                navigate('/');
              }}
            >
              退出
            </button>
          </div>
          {/* 玩家视角的审批提示（仅当该玩家也在页面上时可见——但旁观者只看自己，所以审批由 playing 阶段处理） */}
          <GameViewComponent view={mp.view} onAction={() => {}} onReorderHand={() => {}} />
        </div>
      </>
    );
  }

  // 旁观者在等待阶段（游戏未开始）
  if (mp.stage === 'spectating') {
    return (
      <>
        {reconnectBanner}
        <div className={page}>
          <h1 className={title}>旁观等待中</h1>
          <p className={subtitle}>等待房主开始游戏</p>
          <div className={card}>
            <div className={roomCodeBox}>
              <div className={roomCodeLabel}>房间码</div>
              <div className={roomCode}>{mp.roomId ?? '加载中…'}</div>
            </div>
            <div className={readyInfo}>
              玩家：{mp.roomState?.playerIds.length ?? 0} / {mp.roomState?.maxPlayers ?? 0}
            </div>
            {/* 房间配置（旁观者可见） */}
            {mp.roomState?.config && (
              <div className={configGrid}>
                <div className={configItem}>
                  <span className={configKey}>房间名</span>
                  <span className={configVal}>{mp.roomState.config.name}</span>
                </div>
                <div className={configItem}>
                  <span className={configKey}>将池</span>
                  <span className={configVal}>{POOL_LABELS[mp.roomState.config.charPool] ?? mp.roomState.config.charPool}</span>
                </div>
                <div className={configItem}>
                  <span className={configKey}>操作倒计时</span>
                  <span className={configVal}>{timeoutLabel(mp.roomState.config.timeoutScale)}</span>
                </div>
                <div className={configItem}>
                  <span className={configKey}>初始手牌</span>
                  <span className={configVal}>{mp.roomState.config.handSize} 张</span>
                </div>
                <div className={configItem}>
                  <span className={configKey}>聊天</span>
                  <span className={configVal}>{mp.roomState.config.chat?.enabled ? '开启' : '关闭'}</span>
                </div>
              </div>
            )}
            <div className={buttonRow}>
              <button
                className={btnStyle}
                style={{ '--btn-bg': colors.disabled } as React.CSSProperties}
                onClick={() => {
                  mp.leaveRoom();
                  navigate('/');
                }}
              >
                退出
              </button>
            </div>
          </div>
          {mp.error && <div className={errorToastStyle}>{mp.error}</div>}
        </div>
      </>
    );
  }

  if (mp.stage === 'playing' && mp.view) {
    return (
      <>
        {reconnectBanner}
        <div className={gameWrap}>
          <GameViewComponent view={mp.view} onAction={handleAction} onReorderHand={mp.reorderHand} />
          <ChatPanel
            messages={mp.chatMessages}
            config={mp.roomState?.config?.chat}
            onSend={mp.sendChat}
            mySeatIndex={mp.view.viewer}
          />
        </div>
      </>
    );
  }

  if (mp.stage === 'ended' || mp.gameOver) {
    return (
      <>
        {reconnectBanner}
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
                onClick={handleDownloadReplay}
              >
                ⬇ 下载录像
              </button>
              <button
                className={btnStyle}
                style={{ '--btn-bg': colors.accent.blue } as React.CSSProperties}
                onClick={() => {
                  mp.leaveRoom();
                  navigate('/');
                }}
              >
                返回大厅
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (mp.stage === 'waiting') {
    return (
      <>
        {reconnectBanner}
        <div className={page}>
          <h1 className={title}>等待大厅</h1>
          <p className={subtitle}>等待玩家加入并准备</p>
          <div className={card}>
          <div className={roomCodeBox}>
            <div className={roomCodeLabel}>房间码（分享给其他玩家）</div>
            <div className={roomCode}>{mp.roomId ?? '加载中…'}</div>
          </div>
          <div className={readyInfo}>
            当前用户：{mp.playerId ?? '未知'}{mp.isHost ? '（房主）' : ''}
          </div>
          {mp.roomState?.hostId && !mp.isHost && (
            <div className={readyInfo} style={{ fontSize: '13px', color: colors.text.muted }}>
              房主：{mp.roomState.hostId}
            </div>
          )}
          {/* 房间配置（所有人可见） */}
          {mp.roomState?.config && (
            <div className={configGrid}>
              <div className={configItem}>
                <span className={configKey}>房间名</span>
                <span className={configVal}>{mp.roomState.config.name}</span>
              </div>
              <div className={configItem}>
                <span className={configKey}>将池</span>
                <span className={configVal}>{POOL_LABELS[mp.roomState.config.charPool] ?? mp.roomState.config.charPool}</span>
              </div>
              <div className={configItem}>
                <span className={configKey}>操作倒计时</span>
                <span className={configVal}>{timeoutLabel(mp.roomState.config.timeoutScale)}</span>
              </div>
              <div className={configItem}>
                <span className={configKey}>初始手牌</span>
                <span className={configVal}>{mp.roomState.config.handSize} 张</span>
              </div>
              <div className={configItem}>
                <span className={configKey}>聊天</span>
                <span className={configVal}>{mp.roomState.config.chat?.enabled ? '开启' : '关闭'}</span>
              </div>
            </div>
          )}
          <div className={readyInfo}>
            已就绪：{readyCount} / {playerCount}（满 {maxPlayers} 人）
          </div>
          {/* 旁观者列表 */}
          {spectatorCount > 0 && (
            <div className={readyInfo} style={{ fontSize: '13px', color: colors.text.muted }}>
              👁 旁观者：{spectatorCount} 人
            </div>
          )}
          {/* 房主聊天配置 */}
          {mp.isHost && mp.roomState?.config?.chat && (
            <ChatConfigSection
              config={mp.roomState.config.chat}
              onChange={(chatConfig) =>
                mp.updateConfig({ ...mp.roomState!.config, chat: chatConfig })
              }
            />
          )}
          {/* 待处理申请提示 */}
          {Object.entries(pendingRequests).map(([sid, seat]) => (
            <div key={sid} style={{ background: colors.bg.input, borderRadius: '8px', padding: '10px', marginBottom: '8px', fontSize: '13px' }}>
              <span>{sid.slice(0, 8)} 申请查看 P{seat} 视角</span>
              <button
                className={btnStyle}
                style={{ '--btn-bg': colors.accent.green, '--btn-padding': '4px 12px', '--btn-font-size': '12px', marginLeft: '8px' } as React.CSSProperties}
                onClick={() => mp.approveView(sid, seat)}
              >同意</button>
              <button
                className={btnStyle}
                style={{ '--btn-bg': colors.accent.red, '--btn-padding': '4px 12px', '--btn-font-size': '12px', marginLeft: '4px' } as React.CSSProperties}
                onClick={() => mp.rejectView(sid)}
              >拒绝</button>
            </div>
          ))}
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
              <button
                className={btnStyle}
                style={{ '--btn-bg': colors.disabled } as React.CSSProperties}
                onClick={mp.toggleReady}
              >
                取消准备
              </button>
            )}
            {mp.isHost && (
              <button
                className={btnStyle}
                style={
                  {
                    '--btn-bg': allReady ? colors.accent.orange : colors.disabled,
                    '--btn-cursor': allReady ? 'pointer' : 'not-allowed',
                  } as React.CSSProperties
                }
                disabled={!allReady}
                onClick={mp.startGame}
              >
                开始游戏
              </button>
            )}
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.disabled } as React.CSSProperties}
              onClick={() => {
                mp.leaveRoom();
                navigate('/');
              }}
            >
              退出
            </button>
          </div>
        </div>
        {mp.error && <div className={errorToastStyle}>{mp.error}</div>}
        <ChatPanel
          messages={mp.chatMessages}
          config={mp.roomState?.config?.chat}
          onSend={mp.sendChat}
          mySeatIndex={-1}
        />
        </div>
      </>
    );
  }

  // lobby 阶段
  return (
    <div className={page}>
      <h1 className={title}>多人游戏</h1>
      <p className={subtitle}>创建房间或选择房间加入</p>
      <div className={lobbyRow}>
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
            <label className={label}>房间类型</label>
            <select
              className={inputStyle}
              value={createRoomType}
              onChange={(e) => setCreateRoomType(e.target.value as 'quick' | 'normal')}
            >
              <option value="quick">快速房间（人走自动销毁）</option>
              <option value="normal">普通房间（持久保留）</option>
            </select>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleJoin();
              }}
            />
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.blue } as React.CSSProperties}
              onClick={handleJoin}
            >
              加入房间
            </button>
          </div>
          <div className={returnHomeRow}>
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.disabled } as React.CSSProperties}
              onClick={() => navigate('/')}
            >
              返回首页
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
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.blue } as React.CSSProperties}
              onClick={handleSpectate}
            >
              👁 旁观加入
            </button>
          </div>
        </div>
        <RoomListPanel
          rooms={rooms}
          onRefresh={fetchRooms}
          onJoin={mp.joinRoom}
          onDelete={handleDeleteRoom}
          onSpectate={mp.joinAsSpectator}
          emptyText="暂无公开房间"
          currentPlayerId={mp.playerId}
        />
      </div>
      {mp.error && <div className={errorToastStyle}>{mp.error}</div>}
    </div>
  );
}
