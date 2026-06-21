// src/components/DebugLobby.tsx — 调试大厅入口（新 ENGINE-DESIGN）
//
// 用 useDebugLobbyController 拿 GameView + sendAction。
// 已加入房间 → <GameViewComponent>, 否则 → <DebugRoomList>。

import { useNavigate } from 'react-router-dom';
import { useDebugLobbyController } from '../hooks/useDebugLobbyController';
import { useDebugPerspective } from '../hooks/useDebugPerspective';
import { DebugControls } from './debug/DebugControls';
import { DebugRoomList } from './debug/DebugRoomList';
import { GameViewComponent, type ActionMsg } from './GameView';
import { DebugInfo } from './DebugInfo';
import { styles } from '../theme';
import type { RoomInfo } from '../../server/protocol';

interface DebugLobbyProps {
  onExit: () => void;
  initialRoomId?: string;
}

export function DebugLobby({ onExit: _onExit, initialRoomId }: DebugLobbyProps) {
  const navigate = useNavigate();
  const c = useDebugLobbyController(initialRoomId);

  if (c.view) {
    return (
      <div>
        <DebugGameView
          view={c.view}
          onAction={c.sendAction}
          onReorderHand={c.reorderHand}
          onDeleteRoom={c.handleDeleteRoom}
        />
      </div>
    );
  }

  const rooms: RoomInfo[] = c.debugRooms;
  return (
    <div style={styles.page(40)}>
      <DebugControls onBack={() => navigate('/')} showConnection connected={c.connected} />
      <DebugRoomList
        connected={c.connected}
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

/** debug 模式游戏视图:GameView + 视角管理 + 调试面板。 */
function DebugGameView({
  view, onAction, onReorderHand, onDeleteRoom,
}: {
  view: import('../../engine/types').GameView;
  onAction: (action: ActionMsg) => void;
  onReorderHand?: (order: string[]) => void;
  onDeleteRoom: () => void;
}) {
  const { perspective, switchPerspective, goToCurrentPlayer, setPerspective, autoSwitchCtl } = useDebugPerspective(view);
  const perspectiveName = view.players[perspective]?.name ?? `P${perspective}`;
  return (
    <>
      <GameViewComponent
        view={view}
        onAction={onAction}
        onReorderHand={onReorderHand}
        perspective={perspective}
        onSwitchPerspective={switchPerspective}
        onGoToCurrentPlayer={goToCurrentPlayer}
        onPerspectiveChange={setPerspective}
        autoSwitchCtl={autoSwitchCtl}
        onDeleteRoom={onDeleteRoom}
      />
      {/* debug 专属:调试信息面板(日志在 GameView 内,正常功能) */}
      <DebugInfo view={view} perspectiveName={perspectiveName} pending={view.pending} />
    </>
  );
}
