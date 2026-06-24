// src/components/DebugLobby.tsx — 调试大厅入口(多 WS 版)
//
// useDebugLobbyController 管理房间列表/创建/删除。
// useDebugMultiConnection 管理 N 个座次连接 + views Map。
// useDebugPerspective 管理视角切换。
// 已加入房间 → <GameViewComponent>(渲染当前 perspective 的 view), 否则 → <DebugRoomList>。

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebugLobbyController } from '../hooks/useDebugLobbyController';
import { useDebugMultiConnection, type ActionMsg } from '../hooks/useDebugMultiConnection';
import { useDebugPerspective } from '../hooks/useDebugPerspective';
import { SubmittedCharSelectProvider } from '../hooks/SubmittedCharSelectCtx';
import { DebugControls } from './debug/DebugControls';
import { DebugRoomList } from './debug/DebugRoomList';
import { GameViewComponent } from './GameView';
import { DebugPerspectiveBar } from './DebugPerspectiveBar';
import { DebugInfo } from './DebugInfo';
import { EventOverlay } from './EventOverlay';
import { styles } from '../theme';
import type { RoomInfo } from '../../server/protocol';
import type { GameView as EngineGameView } from '../../engine/types';

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
    <div style={styles.page(40)}>
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
      {c.error && <div style={styles.errorToast()}>{c.error}</div>}
    </div>
  );
}

/** debug 模式游戏视图:多 WS 连接 + 视角管理 + 调试面板 + 事件 overlay。 */
function DebugGameView({
  roomId, playerCount, onDeleteRoom,
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
  roomId, playerCount, onDeleteRoom,
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
  const currentView = conn.views.get(perspective) ?? null;
  const pctl = useDebugPerspective(conn.views, perspective, playerCount, setPerspective);

  if (!currentView) {
    return (
      <div style={styles.page(40)}>
        <DebugControls onBack={() => onDeleteRoom()} />
        <div style={{ color: '#aaa', textAlign: 'center', marginTop: 40 }}>
          正在连接各座次视角…
        </div>
      </div>
    );
  }

  const view = currentView as unknown as EngineGameView;
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
    />
  );

  return (
    <>
      <GameViewComponent
        view={view}
        onAction={conn.sendAction}
        onReorderHand={conn.reorderHand}
        onSeatDoubleClick={setPerspective}
        headerSlot={headerBar}
        overlaySlot={overlayBar}
      />
      <EventOverlay current={conn.currentEvent} view={view} perspective={perspective} />
      <DebugInfo view={view} perspectiveName={perspectiveName} pending={view.pending} />
    </>
  );
}
