// src/client/pages/multiplayer/WaitingStage.tsx
// 等待大厅(玩家 waiting 与旁观者 spectating 无 view 时共用):
// 房间码+复制、房主配置编辑(委托 RoomConfigSection)、新手教程、对局历史、已就绪/旁观者列表、
// 聊天配置、待处理视角申请、座位图(SeatMap)、底部准备/开始/旁观/退出按钮。
// 持有 editConfig 与复制反馈 state;对局历史 history 由页面 useRoomHistory 传入(刷新语义不变)。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingGuide } from '../../components/OnboardingGuide';
import { RoomHistoryPanel } from '../../components/RoomHistoryPanel';
import { ChatConfigSection } from '../../components/ChatConfigSection';
import { copyToClipboard } from '../../utils/clipboard';
import { memberName } from '../../utils/memberNames';
import { btnStyle, colors } from '../../theme';
import { useMultiplayerRoomCtx } from './MultiplayerRoomCtx';
import { ErrorToast } from './ErrorToast';
import { ReconnectBanner } from './ReconnectBanner';
import { RoomConfigSection } from './RoomConfigSection';
import { SeatMap } from './SeatMap';
import {
  page,
  pageTitle,
  subtitle,
  card,
  roomCodeBox,
  roomCodeLabel,
  roomCode,
  copyBtnRow,
  readyInfo,
  buttonRow,
} from './multiplayerStyles';
import type { RoomConfig } from '../../../server/protocol';
import type { RoomHistory } from '../../hooks/useRoomHistory';

interface WaitingStageProps {
  /** 对局历史(useRoomHistory 返回值,由页面持有传入) */
  history: RoomHistory;
}

export function WaitingStage({ history }: WaitingStageProps) {
  const mp = useMultiplayerRoomCtx();
  const navigate = useNavigate();

  // 房间码/邀请链接复制反馈:成功后按钮短暂显示 ✓,2 秒后恢复(范式同 DebugPerspectiveBar)。
  // 用单一状态 + 可清除计时器:连续点两个按钮时,后点的反馈覆盖先点的,旧计时器不残留。
  const [copiedKind, setCopiedKind] = useState<'code' | 'link' | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    // 卸载清理计时器,避免对已卸载组件 setState
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);
  const handleCopyRoomInfo = useCallback(
    async (kind: 'code' | 'link') => {
      if (!mp.roomId) return;
      // 邀请链接走 /play/:roomId 路由,App.tsx 已支持 autoJoin 直达
      const text = kind === 'code' ? mp.roomId : `${window.location.origin}/play/${mp.roomId}`;
      const ok = await copyToClipboard(text);
      if (ok) {
        setCopiedKind(kind);
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => setCopiedKind(null), 2000);
      }
      // 复制失败静默:两条复制路径都失败时无可靠反馈手段,不弹错打扰用户
    },
    [mp.roomId],
  );

  // waiting 阶段房主配置编辑状态（首次从服务端同步后由用户控制）
  const [editConfig, setEditConfig] = useState<RoomConfig | null>(null);
  const editConfigInitRef = useRef(false);
  useEffect(() => {
    if (!editConfigInitRef.current && mp.roomState?.config) {
      setEditConfig(mp.roomState.config);
      editConfigInitRef.current = true;
    }
  }, [mp.roomState?.config]);
  const handleConfigField = useCallback(<K extends keyof RoomConfig>(key: K, value: RoomConfig[K]) => {
    setEditConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const allReady =
    mp.roomState &&
    mp.roomState.readyPlayers.length === mp.roomState.playerIds.length &&
    mp.roomState.playerIds.length >= 2;
  const readyCount = mp.roomState?.readyPlayers.length ?? 0;
  const playerCount = mp.roomState?.playerIds.length ?? 0;
  // 原 fallback 为 lobby 表单的 createMax(初值 2);表单状态已随 LobbyStage 下沉,这里用同初值兜底
  const maxPlayers = mp.roomState?.maxPlayers ?? 2;
  const spectatorCount = mp.roomState?.spectatorIds.length ?? 0;
  const pendingRequests = mp.roomState?.pendingViewRequests ?? {};

  return (
    <>
      <ReconnectBanner
        connectionState={mp.connectionState}
        reconnectAttempt={mp.reconnectAttempt}
        onCancel={mp.cancelReconnect}
        onLeave={() => {
          mp.leaveRoom();
          navigate('/');
        }}
      />
      <div className={page}>
        <h1 className={pageTitle}>等待大厅</h1>
        <p className={subtitle}>{mp.isSpectator ? '👁 旁观中 · 点击空位加入游戏' : '等待玩家加入并准备'}</p>
        <div className={card}>
          <div className={roomCodeBox}>
            <div className={roomCodeLabel}>房间码（分享给其他玩家）</div>
            <div className={roomCode}>{mp.roomId ?? '加载中…'}</div>
            <div className={copyBtnRow}>
              <button
                className={btnStyle}
                disabled={!mp.roomId}
                onClick={() => void handleCopyRoomInfo('code')}
                style={{
                  '--btn-bg': colors.bg.input,
                  '--btn-padding': '4px 14px',
                  '--btn-font-size': '12px',
                  '--btn-cursor': mp.roomId ? 'pointer' : 'not-allowed',
                  opacity: mp.roomId ? 1 : 0.6,
                } as React.CSSProperties}
              >
                {copiedKind === 'code' ? '✓ 已复制' : '复制房间码'}
              </button>
              <button
                className={btnStyle}
                disabled={!mp.roomId}
                onClick={() => void handleCopyRoomInfo('link')}
                style={{
                  '--btn-bg': colors.bg.input,
                  '--btn-padding': '4px 14px',
                  '--btn-font-size': '12px',
                  '--btn-cursor': mp.roomId ? 'pointer' : 'not-allowed',
                  opacity: mp.roomId ? 1 : 0.6,
                } as React.CSSProperties}
              >
                {copiedKind === 'link' ? '✓ 已复制' : '复制邀请链接'}
              </button>
            </div>
          </div>
          <div className={readyInfo}>
            当前用户：{memberName(mp.playerId, mp.roomState?.playerNames)}{mp.isHost ? '（房主）' : ''}
          </div>
          {mp.roomState?.hostId && !mp.isHost && (
            <div className={readyInfo} style={{ fontSize: '13px', color: colors.text.muted }}>
              房主：{memberName(mp.roomState.hostId, mp.roomState?.playerNames)}
            </div>
          )}
          <RoomConfigSection
            editConfig={editConfig}
            onFieldChange={handleConfigField}
            onCommit={mp.updateConfig}
          />
          {/* 新手教程（房间码/配置区之后，纯静态图文，无副作用） */}
          <OnboardingGuide />
          {/* 对局历史:本房间历史结果/重放/下载;房主可删除清空 */}
          <RoomHistoryPanel
            roomId={mp.roomId}
            playerId={mp.playerId}
            history={history}
            isHost={mp.isHost}
          />
          <div className={readyInfo}>
            已就绪：{readyCount} / {playerCount}（满 {maxPlayers} 人）
          </div>
          {/* 旁观者列表 */}
          {spectatorCount > 0 && (
            <div className={readyInfo} style={{ fontSize: '13px', color: colors.text.muted, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              <span>👁 旁观者：{spectatorCount} 人</span>
              {mp.isHost &&
                (mp.roomState?.spectatorIds ?? []).map((sid) => (
                  <span
                    key={sid}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: colors.bg.input,
                      borderRadius: '12px',
                      padding: '2px 4px 2px 10px',
                    }}
                  >
                    {memberName(sid, mp.roomState?.playerNames)}
                    <button
                      className={btnStyle}
                      title="踢出该旁观者"
                      style={{
                        '--btn-bg': colors.accent.red,
                        '--btn-padding': '0',
                        '--btn-font-size': '11px',
                        width: '16px',
                        height: '16px',
                        minWidth: 0,
                        lineHeight: '16px',
                        borderRadius: '50%',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                      } as React.CSSProperties}
                      onClick={() => {
                        if (window.confirm(`确定将旁观者  踢出房间吗？`)) {
                          mp.kickPlayer(sid);
                        }
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
            </div>
          )}
          {/* 房主聊天配置 */}
          {mp.isHost && editConfig?.chat && (
            <ChatConfigSection
              config={editConfig.chat}
              onChange={(chatConfig) => {
                const updated = { ...editConfig, chat: chatConfig };
                setEditConfig(updated);
                mp.updateConfig(updated);
              }}
            />
          )}
          {/* 待处理申请提示 */}
          {Object.entries(pendingRequests).map(([sid, seat]) => (
            <div key={sid} style={{ background: colors.bg.input, borderRadius: '8px', padding: '10px', marginBottom: '8px', fontSize: '13px' }}>
              <span>{memberName(sid, mp.roomState?.playerNames)} 申请查看 P{seat} 视角</span>
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
          {/* 座位图 */}
          <SeatMap />
          <div className={buttonRow}>
            {!mp.isSpectator && !mp.ready && (
              <button
                className={btnStyle}
                style={{ '--btn-bg': '#a03028' } as React.CSSProperties}
                onClick={mp.toggleReady}
              >
                准备
              </button>
            )}
            {!mp.isSpectator && mp.ready && (
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
                    '--btn-bg': allReady ? '#b8912f' : colors.disabled,
                    '--btn-cursor': allReady ? 'pointer' : 'not-allowed',
                  } as React.CSSProperties
                }
                disabled={!allReady}
                onClick={mp.startGame}
              >
                开始游戏
              </button>
            )}
            {mp.isSpectator ? (
              <button
                className={btnStyle}
                style={
                  {
                    '--btn-bg': playerCount < maxPlayers ? colors.accent.gold : colors.disabled,
                    '--btn-cursor': playerCount < maxPlayers ? 'pointer' : 'not-allowed',
                  } as React.CSSProperties
                }
                disabled={playerCount >= maxPlayers}
                onClick={() => mp.switchRole('player')}
                title={playerCount < maxPlayers ? '点击加入游戏' : '房间已满，无法加入'}
              >
                👁 旁观中（加入游戏）
              </button>
            ) : (
              <button
                className={btnStyle}
                style={{ '--btn-bg': colors.bg.input } as React.CSSProperties}
                onClick={() => mp.switchRole('spectator')}
                title="切换为旁观者，不参与本局游戏"
              >
                👁 旁观
              </button>
            )}
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.bg.input } as React.CSSProperties}
              onClick={() => {
                mp.leaveRoom();
                navigate('/');
              }}
            >
              退出
            </button>
          </div>
        </div>
        {mp.error && <ErrorToast message={mp.error} onClose={mp.clearError} />}
      </div>
    </>
  );
}
