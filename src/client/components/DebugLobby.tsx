// src/components/DebugLobby.tsx — 调试大厅入口（新 ENGINE-DESIGN）
//
// 用 useDebugLobbyController 拿 GameView + sendAction。
// 已加入房间 → <GameViewComponent>, 否则 → <DebugRoomList>。

import { useNavigate } from 'react-router-dom';
import { useDebugLobbyController } from '../hooks/useDebugLobbyController';
import { DebugControls } from './debug/DebugControls';
import { DebugRoomList } from './debug/DebugRoomList';
import { GameViewComponent } from './GameView';
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
        <GameViewComponent
          view={c.view}
          playerNames={c.playerNames}
          onAction={c.sendAction}
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
