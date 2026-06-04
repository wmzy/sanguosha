// src/components/DebugLobby.tsx — 调试大厅入口（纯编排）
//
// T10 拆分后，本组件只负责：
//   1. 调用 useDebugLobbyController 拿到所有状态 + handler
//   2. 根据"是否已加入房间"在 <DebugRoomList> 和 <DebugPlayerList> 之间路由
//   3. 渲染顶部 <DebugControls>
//
// 所有 WebSocket / reducer / handler / useEffect 逻辑在 hook 里：
//   - src/hooks/useDebugLobbyController.ts

import { useNavigate } from 'react-router-dom';
import { useDebugLobbyController } from '../hooks/useDebugLobbyController';
import { DebugControls } from './debug/DebugControls';
import { DebugRoomList } from './debug/DebugRoomList';
import { DebugPlayerList } from './debug/DebugPlayerList';
import { styles } from '../theme';
import type { RoomInfo } from '../../server/protocol';

interface DebugLobbyProps {
  onExit: () => void;
  initialRoomId?: string;
}

export function DebugLobby({ onExit: _onExit, initialRoomId }: DebugLobbyProps) {
  const navigate = useNavigate();
  const c = useDebugLobbyController(initialRoomId);

  if (c.state) {
    return (
      <div>
        <DebugControls onBack={c.handleExit} onDeleteRoom={c.handleDeleteRoom} />
        <DebugPlayerList
          state={c.state}
          ui={{
            perspective: c.ui.perspective,
            playerOrder: c.ui.playerOrder,
            selectedCardId: c.ui.selectedCardId,
            selectedTarget: c.ui.selectedTarget,
            selectedForDiscard: c.ui.selectedForDiscard,
            selectedSkillCards: c.ui.selectedSkillCards,
          }}
          actions={{
            setPerspective: c.setPerspective,
            setPlayerOrder: c.setPlayerOrder,
            setSelectedCardId: c.setSelectedCardId,
            setSelectedTarget: c.setSelectedTarget,
            toggleSelectedForDiscard: c.toggleSelectedForDiscard,
            clearSelectedForDiscard: c.clearSelectedForDiscard,
            toggleSelectedSkillCard: c.toggleSelectedSkillCard,
            clearSelectedSkillCards: c.clearSelectedSkillCards,
          }}
          actionLog={c.ui.actionLog}
          sendGameAction={c.sendGameAction}
        />
      </div>
    );
  }

  const rooms: RoomInfo[] = c.ui.debugRooms;
  return (
    <div style={styles.page(40)}>
      <DebugControls onBack={() => navigate('/')} showConnection connected={c.connected} />
      <DebugRoomList
        connected={c.connected}
        playerCount={c.ui.playerCount}
        onPlayerCountChange={c.setPlayerCount}
        onCreateRoom={c.handleCreateDebugRoom}
        rooms={rooms}
        onRefresh={c.refreshRoomList}
        onJoin={c.handleJoinDebugRoom}
        onDelete={c.handleDeleteDebugRoom}
      />
      {c.ui.error && <div style={styles.errorToast()}>{c.ui.error}</div>}
    </div>
  );
}
