// src/components/DebugLobby.tsx — 调试大厅入口(多 WS 版)
//
// useDebugLobbyController 管理房间列表/创建/删除。
// useDebugMultiConnection 管理 N 个座次连接 + views Map。
// useDebugPerspective 管理视角切换。
// 已加入房间 → <GameViewComponent>(渲染当前 perspective 的 view), 否则 → <DebugRoomList>。

// src/components/DebugLobby.tsx — 调试大厅入口(多 WS 版)
//
// useDebugLobbyController 管理房间列表/创建/删除。
// useDebugMultiConnection 管理 N 个座次连接 + views Map。
// useDebugPerspective 管理视角切换。
// 已加入房间 → <GameViewComponent>(渲染当前 perspective 的 view), 否则 → <DebugRoomList>。
import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebugLobbyController } from '../hooks/useDebugLobbyController';
import { useDebugMultiConnection } from '../hooks/useDebugMultiConnection';
import { useDebugPerspective } from '../hooks/useDebugPerspective';
import { useSnapshot } from '../hooks/useSnapshot';
import { SubmittedCharSelectProvider } from '../hooks/SubmittedCharSelectCtx';
import { DebugControls } from './debug/DebugControls';
import { DebugRoomList } from './debug/DebugRoomList';
import { RoomConfigPanel } from './debug/RoomConfigPanel';
import { GameViewComponent } from './GameView';
import { GameResultOverlay } from './GameResultOverlay';
import { DebugPerspectiveBar } from './DebugPerspectiveBar';
import { DebugInfo } from './DebugInfo';
import { pageStyle, errorToastStyle } from '../theme';
import { css } from '@linaria/core';

const connectingHint = css`
  color: #aaa;
  text-align: center;
  margin-top: 40px;
`;
import { installTelemetry, uninstallTelemetry, logUserAction } from '../utils/debugTelemetry';
import type { RoomInfo } from '../../server/protocol';

interface DebugLobbyProps {
  onExit: () => void;
  initialRoomId?: string;
}

export function DebugLobby({ onExit: _onExit, initialRoomId }: DebugLobbyProps) {
  const navigate = useNavigate();
  const c = useDebugLobbyController(initialRoomId);

  if (c.activeRoomId) {
    return (
      <DebugGameView
        roomId={c.activeRoomId}
        playerCount={c.playerCount}
        onDeleteRoom={c.handleDeleteRoom}
      />
    );
  }

  const rooms: RoomInfo[] = c.debugRooms;
  return (
    <div className={pageStyle} style={{ '--page-padding': '40px' } as React.CSSProperties}>
      <DebugControls onBack={() => navigate('/')} />
      <DebugRoomList
        playerCount={c.playerCount}
        onPlayerCountChange={c.setPlayerCount}
        onCreateRoom={c.handleCreateDebugRoom}
        rooms={rooms}
        onRefresh={c.refreshRoomList}
        onJoin={c.handleJoinDebugRoom}
        onDelete={c.handleDeleteDebugRoom}
      />
      {c.error && <div className={errorToastStyle}>{c.error}</div>}
    </div>
  );
}

/** debug 模式游戏视图:多 WS 连接 + 视角管理 + 调试面板 + 事件 overlay。 */
function DebugGameView({
  roomId,
  playerCount,
  onDeleteRoom,
}: {
  roomId: string;
  playerCount: number;
  onDeleteRoom: () => void;
}) {
  return (
    <SubmittedCharSelectProvider>
      <DebugGameViewInner roomId={roomId} playerCount={playerCount} onDeleteRoom={onDeleteRoom} />
    </SubmittedCharSelectProvider>
  );
}

function DebugGameViewInner({
  roomId,
  playerCount,
  onDeleteRoom,
}: {
  roomId: string;
  playerCount: number;
  onDeleteRoom: () => void;
}) {
  const [perspective, setPerspective] = useState(0);
  const conn = useDebugMultiConnection({
    roomId,
    playerCount,
    perspective,
    onFirstView: (v) => setPerspective(v),
  });

  // 安装遥测:debug 游戏视图挂载时启动,卸载时清理。
  // 幂等(install/uninstall 内部有 installed 守卫),StrictMode 双挂载安全。
  useEffect(() => {
    installTelemetry();
    return () => uninstallTelemetry();
  }, []);

  // 视角切换记录到遥测(包装 setPerspective)
  const handleSetPerspective = useCallback((p: number) => {
    logUserAction('perspective', p);
    setPerspective(p);
  }, []);

  const snap = useSnapshot();
  const {
    createSnapshot: createSnap,
    patchDescription: patchSnap,
    clearError: clearSnapError,
  } = snap;
  const { views: connViews, getSeq: connGetSeq } = conn;

  const handleSaveSnapshot = useCallback(async () => {
    const snapshotId = await createSnap({
      roomId,
      perspective,
      views: connViews,
      getSeqForView: (seat) => connGetSeq(seat),
    });
    if (snapshotId) {
      const desc = window.prompt('快照已保存。请描述你发现的 bug(可留空):');
      if (desc !== null && desc.trim()) {
        await patchSnap(snapshotId, desc.trim());
      }
    }
  }, [createSnap, patchSnap, roomId, perspective, connViews, connGetSeq]);

  // 3 秒后自动清除 toast/error
  useEffect(() => {
    if (snap.lastSnapshotPath || snap.error) {
      const t = setTimeout(() => clearSnapError(), 3000);
      return () => clearTimeout(t);
    }
  }, [snap.lastSnapshotPath, snap.error, clearSnapError]);

  const currentView = conn.views.get(perspective) ?? null;
  const pctl = useDebugPerspective(conn.views, perspective, playerCount, handleSetPerspective);

  // ── 配置阶段:游戏未开始时显示配置面板 ──
  if (!conn.gameStarted && !currentView) {
    return (
      <RoomConfigPanel
        config={
          conn.roomState?.config ?? { name: '', timeoutScale: 1, charPool: 'all', handSize: 4 }
        }
        readyPlayers={conn.roomState?.readyPlayers ?? []}
        playerIds={conn.roomState?.playerIds ?? []}
        seatPlayerIds={conn.seatPlayerIds}
        maxPlayers={playerCount}
        connectedCount={conn.connectedCount}
        perspective={perspective}
        onSwitchPerspective={handleSetPerspective}
        onReady={conn.sendReady}
        onStart={conn.sendStartGame}
        onUpdateConfig={conn.sendUpdateConfig}
        onExit={onDeleteRoom}
        error={null}
      />
    );
  }

  if (!currentView) {
    return (
      <div className={pageStyle} style={{ '--page-padding': '40px' } as React.CSSProperties}>
        <DebugControls onBack={() => onDeleteRoom()} />
        <div className={connectingHint}>正在连接各座次视角…</div>
      </div>
    );
  }

  const view = currentView;
  const perspectiveName = view.players[perspective]?.name ?? `P${perspective}`;

  // debug 模式视角控制 UI:渲染到 GameViewComponent 的插槽,不进入组件内部。
  // headerSlot(顶部栏右侧):视角切换 / 跳转 / 自动跟随 / 退出。
  // overlaySlot(选将/等待遮罩角落):额外提供「下一个待选者」按钮,跳过已选完座次,
  //   确保最后一个待选者总能被切到(并行选将时不会在已选完玩家间打转)。
  const headerBar = (
    <DebugPerspectiveBar
      perspectiveName={perspectiveName}
      onSwitchPerspective={pctl.switchPerspective}
      onGoToCurrentPlayer={pctl.goToCurrentPlayer}
      autoSwitchCtl={pctl.autoSwitchCtl}
      onDeleteRoom={onDeleteRoom}
      onSaveSnapshot={handleSaveSnapshot}
      snapshotSaving={snap.saving}
      snapshotToast={snap.lastSnapshotPath ? `已保存: ${snap.lastSnapshotPath}` : null}
      snapshotPath={snap.lastSnapshotPath}
      snapshotError={snap.error}
    />
  );
  const overlayBar = (
    <DebugPerspectiveBar
      perspectiveName={perspectiveName}
      onSwitchPerspective={pctl.switchPerspective}
      onSwitchToNextUnselected={pctl.switchToNextUnselected}
      onGoToCurrentPlayer={pctl.goToCurrentPlayer}
      autoSwitchCtl={pctl.autoSwitchCtl}
      onDeleteRoom={onDeleteRoom}
      onSaveSnapshot={handleSaveSnapshot}
      snapshotSaving={snap.saving}
      snapshotToast={snap.lastSnapshotPath ? `已保存: ${snap.lastSnapshotPath}` : null}
      snapshotPath={snap.lastSnapshotPath}
      snapshotError={snap.error}
    />
  );

  return (
    <>
      <GameViewComponent
        view={view}
        onAction={conn.sendAction}
        onReorderHand={conn.reorderHand}
        onSeatDoubleClick={handleSetPerspective}
        headerSlot={headerBar}
        overlaySlot={overlayBar}
        currentEvent={conn.currentEvent}
      />
      <DebugInfo view={view} perspectiveName={perspectiveName} pending={view.pending} />
      {conn.gameOver && (
        <GameResultOverlay
          winner={conn.gameOver.winner}
          players={view.players}
          perspectiveIdx={perspective}
          onRestart={conn.sendRestart}
          onExit={onDeleteRoom}
        />
      )}
    </>
  );
}
