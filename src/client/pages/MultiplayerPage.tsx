// src/client/pages/MultiplayerPage.tsx
// 多人游戏入口页。最小加入页：创建/加入房间 → 等待大厅 → 对局 → 结算。
// 复用单视角 GameViewComponent 渲染玩家自己的座次。
// lobby 阶段展示房间列表(参考 DebugLobby 的 RoomListPanel)。
import { useState, useEffect, useCallback, useRef } from 'react';
import { css } from '@linaria/core';
import { useNavigate, useParams } from 'react-router-dom';
import { useMultiplayerRoom } from '../hooks/useMultiplayerRoom';
import { GameViewComponent } from '../components/GameView';
import { GameResultOverlay } from '../components/GameResultOverlay';
import { RoomListPanel } from '../components/RoomListPanel';
import { RoomHistoryPanel } from '../components/RoomHistoryPanel';
import { useRoomHistory } from '../hooks/useRoomHistory';
import { ChatConfigSection } from '../components/ChatConfigSection';
import { OnboardingGuide } from '../components/OnboardingGuide';
import { colors, pageStyle, btnStyle, inputStyle, errorToastStyle, pageBgStyle, glassPanelStyle, goldHeadingStyle, goldColors } from '../theme';
import { saveReplay } from '../replay/replayFile';
import { apiFetch, ApiError } from '../api/client';
import { copyToClipboard } from '../utils/clipboard';
import { summarizeBattleStats, useBattleStatsEvents } from '../utils/battleStats';
import type { ReplayMeta } from '../replay/types';
import type { ActionMsg } from '../types';
import type { RoomInfo, RoomConfig, CharPoolPreset } from '../../server/protocol';
import type { GameMode } from '../../engine/rules/types';

const page = css`
  ${pageBgStyle}
  background-color: #0d1220;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  padding: 40px 20px;
  color: #eee;
`;

/** 页面主标题:金色 + 底部金色下边线 */
const title = css`
  ${goldHeadingStyle}
  font-size: 36px;
  margin: 0 0 8px;
  letter-spacing: 4px;
  color: ${goldColors.base};
`;

const subtitle = css`
  color: ${colors.text.muted};
  margin: 0 0 32px;
`;

const card = css`
  ${glassPanelStyle}
  padding: 28px;
  width: 100%;
  max-width: 420px;
`;

/** 区块标题:左侧金色竖条 */
const sectionTitle = css`
  font-size: 18px;
  font-weight: bold;
  margin: 0 0 16px;
  color: ${goldColors.light};
  display: flex;
  align-items: center;
  gap: 8px;

  &::before {
    content: '';
    flex-shrink: 0;
    width: 3px;
    height: 16px;
    border-radius: 2px;
    background: linear-gradient(180deg, ${goldColors.base}, ${goldColors.deep});
  }
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
  border: none;
  height: 1px;
  background: linear-gradient(90deg, rgba(241, 196, 15, 0.28), rgba(241, 196, 15, 0.04));
  margin: 24px 0;
`;

const roomCodeBox = css`
  background-color: rgba(18, 24, 40, 0.6);
  border: 2px dashed rgba(241, 196, 15, 0.45);
  border-radius: 10px;
  padding: 20px;
  text-align: center;
  margin-bottom: 20px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
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

/** 房间码下方复制按钮行:居中排布、小巧,不喧宾夺主 */
const copyBtnRow = css`
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 12px;
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

const GAME_MODE_OPTIONS: Array<{ label: string; value: GameMode }> = [
  { label: '身份局（经典 2-8 人）', value: '身份局' },
  { label: '1v1 对决（两人速战）', value: '1v1' },
];

const GAME_MODE_LABELS: Record<string, string> = {
  身份局: '身份局',
  '1v1': '1v1 对决',
};

const POOL_LABELS: Record<string, string> = {

  standard: '标准池 (~32人)',
  extended: '扩展池',
  all: '全武将 (60人)',
};

const TIMEOUT_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '快 (15s)', value: 15 },
  { label: '标准 (30s)', value: 30 },
  { label: '慢 (60s)', value: 60 },
  { label: '无限', value: 0 },
];

function timeoutLabel(v: number): string {
  if (v <= 0) return '无限';
  return `${v}s`;
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
  ${pageBgStyle}
  background-color: ${colors.bg.page};
`;

/**
 * lobby 页容器:顶栏贴顶常驻,主体两栏(左表单/右房间列表)限宽居中。
 * 与 `page` 的居中单列范式分开,避免影响游戏结束等居中分支。
 */
const lobbyPage = css`
  ${pageBgStyle}
  background-color: #0d1220;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  color: #eee;
`;

/** 顶栏:sticky 常驻页面顶部,左侧返回首页,右侧页面标识 */
const topBar = css`
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  background-color: rgba(13, 18, 32, 0.85);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(241, 196, 15, 0.16);
`;

/** 顶栏返回按钮:金色描边幽灵按钮(独立于 btnStyle,避免 border 声明顺序不稳) */
const topBarBtn = css`
  padding: 6px 18px;
  background-color: rgba(241, 196, 15, 0.12);
  color: ${goldColors.light};
  border: 1px solid rgba(241, 196, 15, 0.35);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: bold;
  transition: background-color 0.15s;

  &:hover {
    background-color: rgba(241, 196, 15, 0.24);
  }
`;

/** 顶栏右侧页面标识:淡金小字,撑到最右 */
const topBarTag = css`
  margin-left: auto;
  font-size: 13px;
  letter-spacing: 3px;
  color: ${goldColors.soft};
`;

/** 主体两栏:左列创建/加入表单,右列房间列表;窄屏退化为单列(列表在下) */
const lobbyLayout = css`
  display: grid;
  grid-template-columns: minmax(0, 460px) minmax(300px, 400px);
  gap: 48px;
  justify-content: center;
  align-items: start;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 24px 48px;

  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 460px);
  }
`;

/** 左列:标题 + 表单卡 */
const lobbyMain = css`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

/** 右列房间列表:主内容较长时吸附视口跟随滚动 */
const lobbySide = css`
  position: sticky;
  top: 84px;
  max-height: calc(100vh - 108px);
  overflow-y: auto;

  @media (max-width: 960px) {
    position: static;
    max-height: none;
  }
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
  ${pageBgStyle}
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
  // 对局历史:等待大厅展示;对局结束(gameOver)/回到等待(stage)时刷新
  const history = useRoomHistory(
    mp.roomId,
    mp.playerId,
    mp.gameOver ? 'over' : mp.stage,
  );

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
  const [createGameMode, setCreateGameMode] = useState<GameMode>('身份局');
  const [joinCode, setJoinCode] = useState('');
  const [spectateCode, setSpectateCode] = useState('');

  // lobby 阶段房间列表(参考 DebugLobby)
  const [rooms, setRooms] = useState<RoomInfo[]>([]);

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
    // 1v1 固定两人;身份局沿用所选人数。config 传部分字段,服务端 normalizeRoomConfig 补全。
    const max = createGameMode === '1v1' ? 2 : createMax;
    mp.createRoom(createName.trim(), max, { gameMode: createGameMode } as unknown as RoomConfig, createRoomType);
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
  // 当前玩家座次(用于游戏进行中显示针对自己的旁观申请)
  const mySeat = mp.roomState ? (mp.roomState.seats ?? []).indexOf(mp.playerId ?? '') : -1;
  // 针对当前玩家座次的旁观申请,游戏进行中在顶栏显示审批入口
  const myViewRequests = mySeat >= 0
    ? Object.entries(pendingRequests).filter(([, seat]) => seat === mySeat)
    : [];

  const handleAction = (action: ActionMsg) => mp.sendAction(action);

  // ── 战报统计(伤害/承伤/击杀/回合数)──
  // mp.ingestedEvents 是 ~80 条滑动窗口,结算时一次性统计会丢早期事件;
  // 这里按 seq 增量累计本局的战报相关事件(见 utils/battleStats.ts),
  // 对局中/旁观/结算阶段启用,game_reset 回 waiting 后自动清空。
  const battleEvents = useBattleStatsEvents(
    mp.ingestedEvents,
    mp.stage === 'playing' || mp.stage === 'spectating' || mp.stage === 'ended',
  );

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
    const viewGrants = mp.roomState?.viewGrants ?? {};
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
          <GameViewComponent
            view={mp.view}
            onAction={() => {}}
            onReorderHand={() => {}}
            currentEvent={mp.currentEvent}
            ingestedEvents={mp.ingestedEvents}
            disconnectedSeats={mp.disconnectedSeats}
          />
          {/* 对局中操作被后端拒绝时的错误反馈(此前该分支静默无提示) */}
          {mp.error && (
            <div
              className={errorToastStyle}
              style={{ cursor: 'pointer' }}
              title="点击关闭"
              onClick={mp.clearError}
            >
              {mp.error}
            </div>
          )}
        </div>
      </>
    );
  }

  if (mp.stage === 'playing' && mp.view) {
    return (
      <>
        {reconnectBanner}
        <div className={gameWrap}>
          <GameViewComponent
            view={mp.view}
            onAction={handleAction}
            onReorderHand={mp.reorderHand}
            currentEvent={mp.currentEvent}
            ingestedEvents={mp.ingestedEvents}
            chatMessages={mp.chatMessages}
            chatConfig={mp.roomState?.config?.chat}
            onSendChat={mp.sendChat}
            disconnectedSeats={mp.disconnectedSeats}
            headerSlot={myViewRequests.length > 0 ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {myViewRequests.map(([sid]) => (
                  <span
                    key={sid}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: colors.accent.gold, color: '#000',
                      padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold',
                    }}
                  >
                    👁 {sid.slice(0, 8)} 申请查看你的视角
                    <button
                      className={btnStyle}
                      style={{ '--btn-bg': colors.accent.green, '--btn-padding': '2px 8px', '--btn-font-size': '11px' } as React.CSSProperties}
                      onClick={() => mp.approveView(sid, mySeat)}
                    >同意</button>
                    <button
                      className={btnStyle}
                      style={{ '--btn-bg': colors.accent.red, '--btn-padding': '2px 8px', '--btn-font-size': '11px' } as React.CSSProperties}
                      onClick={() => mp.rejectView(sid)}
                    >拒绝</button>
                  </span>
                ))}
              </div>
            ) : undefined}
          />
          {/* 对局中操作被后端拒绝时的错误反馈(此前该分支静默无提示) */}
          {mp.error && (
            <div
              className={errorToastStyle}
              style={{ cursor: 'pointer' }}
              title="点击关闭"
              onClick={mp.clearError}
            >
              {mp.error}
            </div>
          )}
        </div>
      </>
    );
  }

  if (mp.stage === 'ended' || mp.gameOver) {
    const winner = mp.gameOver?.winner ?? '无人';
    // view 存在时用丰富的结算面板;缺失时回退到简洁文案。
    if (mp.view) {
      // 战报统计:仅结算阶段计算,从本局累计的战报事件汇总(无相关事件则传 undefined,列不渲染)
      const statsAll = summarizeBattleStats(battleEvents);
      const stats = Object.keys(statsAll).length > 0 ? statsAll : undefined;
      return (
        <>
          {reconnectBanner}
          <GameResultOverlay
            winner={winner}
            players={mp.view.players}
            perspectiveIdx={mp.view.viewer}
            stats={stats}
            onRestart={mp.sendRestart}
            onExit={() => {
              mp.leaveRoom();
              navigate('/');
            }}
            onDownloadReplay={handleDownloadReplay}
          />
          {/* 结算面板阶段的错误反馈,与其他 stage 分支行为一致 */}
          {mp.error && (
            <div
              className={errorToastStyle}
              style={{ cursor: 'pointer' }}
              title="点击关闭"
              onClick={mp.clearError}
            >
              {mp.error}
            </div>
          )}
        </>
      );
    }
    return (
      <>
        {reconnectBanner}
        <div className={page}>
          <h1 className={title}>游戏结束</h1>
          <div className={gameOverBox}>
            <p className={winnerText}>
              {winner === '无人' ? '平局' : `胜方：${winner}`}
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

  // 玩家等待 + 旁观等待共用同一个大厅视图,用 mp.isSpectator 区分身份。
  // 旁观者游戏开始后 stage 仍为 'spectating' 但有 mp.view,由上方 spectating+view 分支处理。
  if (mp.stage === 'waiting' || mp.stage === 'spectating') {
    return (
      <>
        {reconnectBanner}
        <div className={page}>
          <h1 className={title}>等待大厅</h1>
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
            当前用户：{mp.playerId ?? '未知'}{mp.isHost ? '（房主）' : ''}
          </div>
          {mp.roomState?.hostId && !mp.isHost && (
            <div className={readyInfo} style={{ fontSize: '13px', color: colors.text.muted }}>
              房主：{mp.roomState.hostId}
            </div>
          )}
          {/* 房间配置（所有人可见） */}
          {/* 房间配置：房主可编辑，非房主只读 */}
          {mp.isHost && editConfig ? (
            <>
              <div className={formRow} style={{ marginBottom: '14px' }}>
                <label className={label}>房间名称</label>
                <input
                  className={inputStyle}
                  type="text"
                  value={editConfig.name}
                  maxLength={40}
                  onChange={(e) => handleConfigField('name', e.target.value)}
                  onBlur={() => mp.updateConfig(editConfig)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label className={label}>游戏模式</label>
                  <select
                    className={inputStyle}
                    value={editConfig.gameMode}
                    onChange={(e) => {
                      const v = e.target.value as GameMode;
                      handleConfigField('gameMode', v);
                      // 1v1 强制两人:同步收紧人数上限
                      const nextMax = v === '1v1' ? 2 : undefined;
                      mp.updateConfig({ ...editConfig, gameMode: v }, nextMax);
                    }}
                  >
                    {GAME_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>将池</label>
                  <select
                    className={inputStyle}
                    value={editConfig.charPool}
                    onChange={(e) => {
                      const v = e.target.value as CharPoolPreset;
                      handleConfigField('charPool', v);
                      mp.updateConfig({ ...editConfig, charPool: v });
                    }}
                  >
                    <option value="standard">标准池 (~32人)</option>
                    <option value="extended">扩展池</option>
                    <option value="all">全武将 (60人)</option>
                  </select>
                </div>
                <div>
                  <label className={label}>操作倒计时</label>
                  <select
                    className={inputStyle}
                    value={editConfig.timeoutSec}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      handleConfigField('timeoutSec', v);
                      mp.updateConfig({ ...editConfig, timeoutSec: v });
                    }}
                  >
                    {TIMEOUT_OPTIONS.map((o) => (
                      <option key={o.label} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    {!TIMEOUT_OPTIONS.some((o) => o.value === editConfig.timeoutSec) && (
                      <option value={editConfig.timeoutSec}>
                        {timeoutLabel(editConfig.timeoutSec)}
                      </option>
                    )}
                  </select>
                </div>
              </div>
              <div className={formRow} style={{ marginBottom: '14px' }}>
                <label className={label}>初始手牌</label>
                <input
                  className={inputStyle}
                  type="number"
                  min={0}
                  max={10}
                  value={editConfig.handSize}
                  onChange={(e) => handleConfigField('handSize', Number(e.target.value))}
                  onBlur={() => mp.updateConfig(editConfig)}
                />
              </div>
              <div className={formRow} style={{ marginBottom: '14px' }}>
                <label className={label}>玩家数量</label>
                <select
                  className={inputStyle}
                  value={mp.roomState?.maxPlayers ?? 2}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    mp.updateConfig(editConfig, v);
                  }}
                >
                  {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>{n} 人</option>
                  ))}
                </select>
              </div>
            </>
          ) : mp.roomState?.config && (
            <div className={configGrid}>
              <div className={configItem}>
                <span className={configKey}>房间名</span>
                <span className={configVal}>{mp.roomState.config.name}</span>
              </div>
              <div className={configItem}>
                <span className={configKey}>游戏模式</span>
                <span className={configVal}>{GAME_MODE_LABELS[mp.roomState.config.gameMode] ?? mp.roomState.config.gameMode ?? '身份局'}</span>
              </div>
              <div className={configItem}>
                <span className={configKey}>将池</span>
                <span className={configVal}>{POOL_LABELS[mp.roomState.config.charPool] ?? mp.roomState.config.charPool}</span>
              </div>
              <div className={configItem}>
                <span className={configKey}>操作倒计时</span>
                <span className={configVal}>{timeoutLabel(mp.roomState.config.timeoutSec)}</span>
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
                    {sid.slice(0, 6)}
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
                        if (window.confirm(`确定将旁观者 ${sid.slice(0, 8)} 踢出房间吗？`)) {
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
          {/* 座位图 */}
          {(() => {
            const seats = mp.roomState?.seats ?? [];
            const mySeat = seats.indexOf(mp.playerId ?? '');
            const pendingSwaps = mp.roomState?.pendingSeatSwaps ?? {};
            // 找出谁请求与我交换
            const swapRequestForMe = mp.incomingSeatSwap;
            // 是否有自己发出的交换请求
            const hasMyRequest = Object.entries(pendingSwaps).find(
              ([reqId]) => reqId === mp.playerId,
            );
            return (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '14px', color: colors.text.muted, marginBottom: '8px' }}>座位安排（{mp.isSpectator ? '点击空位加入游戏' : '点击空位移动，点击他人座位请求交换'}）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {seats.map((seatPlayerId, i) => {
                    const isEmpty = seatPlayerId === null;
                    const isMe = seatPlayerId === mp.playerId;
                    const isPending = Object.entries(pendingSwaps).find(
                      ([, v]) => v.targetSeat === i,
                    );
                    return (
                      <div key={i} style={{ position: 'relative' }}>
                        <button
                          className={btnStyle}
                          disabled={isMe || i === mySeat}
                          style={{
                            '--btn-bg': isMe ? colors.accent.gold : isEmpty ? colors.bg.input : colors.accent.darkRed,
                            '--btn-padding': '8px 14px',
                            '--btn-font-size': '13px',
                            cursor: isMe ? 'default' : 'pointer',
                            opacity: isMe ? 0.8 : 1,
                            border: isEmpty ? `1px dashed ${colors.text.muted}` : '1px solid #555',
                            borderRadius: '8px',
                            minWidth: '90px',
                            textAlign: 'center',
                          } as React.CSSProperties}
                          onClick={() => {
                            // 旁观者点空位 → 占据该座位加入游戏；点他人座位无效
                            if (mp.isSpectator) {
                              if (isEmpty) mp.switchRole('player', i);
                              return;
                            }
                            if (isEmpty) {
                              mp.moveSeat(i);
                            } else if (!isMe) {
                              // 请求交换座位
                              if (window.confirm(`要与 ${seatPlayerId.slice(0, 8)} 交换座位吗？`)) {
                                mp.requestSeatSwap(i);
                              }
                            }
                          }}
                          title={mp.isSpectator ? (isEmpty ? '加入游戏' : '旁观中') : isEmpty ? '移动到此座位' : isMe ? '你的座位' : `请求交换座位`}
                        >
                          <div style={{ fontWeight: 'bold' }}>P{i + 1}</div>
                          <div style={{ fontSize: '11px', opacity: 0.8 }}>
                            {isMe ? '我' : isEmpty ? '空位' : seatPlayerId.slice(0, 6)}
                          </div>
                          {isPending && !isMe && (
                            <div style={{ fontSize: '10px', marginTop: '2px', color: colors.accent.gold }}>
                              交换中...
                            </div>
                          )}
                        </button>
                        {/* 房主踢出该座次玩家 */}
                        {mp.isHost && !isEmpty && !isMe && seatPlayerId !== null && (
                          <button
                            className={btnStyle}
                            title="踢出该玩家"
                            style={{
                              position: 'absolute',
                              top: '-8px',
                              right: '-8px',
                              '--btn-bg': colors.accent.red,
                              '--btn-padding': '0',
                              '--btn-font-size': '12px',
                              width: '20px',
                              height: '20px',
                              minWidth: 0,
                              lineHeight: '20px',
                              borderRadius: '50%',
                              border: `1px solid ${colors.bg.panel}`,
                              cursor: 'pointer',
                              padding: 0,
                              zIndex: 2,
                            } as React.CSSProperties}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`确定将 ${seatPlayerId.slice(0, 8)} 踢出房间吗？`)) {
                                mp.kickPlayer(seatPlayerId);
                              }
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {hasMyRequest && (
                  <div style={{ fontSize: '12px', color: colors.accent.gold, marginTop: '6px' }}>
                    ⏳ 等待对方同意交换座位...
                  </div>
                )}
                {/* 收到的交换请求 */}
                {swapRequestForMe && (
                  <div style={{
                    background: colors.bg.input,
                    borderRadius: '8px',
                    padding: '12px',
                    marginTop: '8px',
                    fontSize: '13px',
                    border: `1px solid ${colors.accent.orange}`,
                  }}>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>{swapRequestForMe.requesterId.slice(0, 8)}</strong> 想与你交换座位
                      （P{swapRequestForMe.requesterSeat + 1} ⇄ P{swapRequestForMe.targetSeat + 1}）
                    </div>
                    <button
                      className={btnStyle}
                      style={{ '--btn-bg': colors.accent.green, '--btn-padding': '4px 14px', '--btn-font-size': '12px' } as React.CSSProperties}
                      onClick={() => mp.respondSeatSwap(swapRequestForMe.requesterId, true)}
                    >同意</button>
                    <button
                      className={btnStyle}
                      style={{ '--btn-bg': colors.accent.red, '--btn-padding': '4px 14px', '--btn-font-size': '12px', marginLeft: '6px' } as React.CSSProperties}
                      onClick={() => mp.respondSeatSwap(swapRequestForMe.requesterId, false)}
                    >拒绝</button>
                  </div>
                )}
              </div>
            );
          })()}
          <div className={buttonRow}>
            {!mp.isSpectator && !mp.ready && (
              <button
                className={btnStyle}
                style={{ '--btn-bg': colors.accent.green } as React.CSSProperties}
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
        {mp.error && (
          <div
            className={errorToastStyle}
            style={{ cursor: 'pointer' }}
            title="点击关闭"
            onClick={mp.clearError}
          >
            {mp.error}
          </div>
        )}
        </div>
      </>
    );
  }

  // lobby 阶段
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
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.orange } as React.CSSProperties}
              onClick={handleCreate}
              disabled={mp.isCreating}
            >
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
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.blue } as React.CSSProperties}
              onClick={handleJoin}
            >
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
            <button
              className={btnStyle}
              style={{ '--btn-bg': colors.accent.blue } as React.CSSProperties}
              onClick={handleSpectate}
            >
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
      {mp.error && (
        <div
          className={errorToastStyle}
          style={{ cursor: 'pointer' }}
          title="点击关闭"
          onClick={mp.clearError}
        >
          {mp.error}
        </div>
      )}
    </div>
  );
}
