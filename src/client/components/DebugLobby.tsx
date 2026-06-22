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
import { DebugControls } from './debug/DebugControls';
import { DebugRoomList } from './debug/DebugRoomList';
import { GameViewComponent } from './GameView';
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
  const [perspective, setPerspective] = useState(0);
  const conn = useDebugMultiConnection({
    roomId,
    playerCount,
    perspective,
    onFirstView: (v) => setPerspective(v),
  });
  const currentView = conn.views.get(perspective) ?? null;
  const pctl = useDebugPerspective(currentView, perspective, playerCount, setPerspective);

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

  return (
    <>
      <GameViewComponent
        view={view}
        onAction={conn.sendAction}
        onReorderHand={conn.reorderHand}
        perspective={perspective}
        onSwitchPerspective={pctl.switchPerspective}
        onGoToCurrentPlayer={pctl.goToCurrentPlayer}
        onPerspectiveChange={setPerspective}
        autoSwitchCtl={pctl.autoSwitchCtl}
        onDeleteRoom={onDeleteRoom}
      />
      <EventOverlay current={conn.currentEvent} view={view} perspective={perspective} />
      <DebugInfo view={view} perspectiveName={perspectiveName} pending={view.pending} />
    </>
  );
}
