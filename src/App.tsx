import { useState } from 'react';
import { GameBoard } from './components/GameBoard';
import { RoomLobby } from './components/RoomLobby';
import { MultiplayerGameBoard } from './components/MultiplayerGameBoard';

type ViewMode = 'local' | 'lobby' | 'multiplayer';

export function App() {
  const [mode, setMode] = useState<ViewMode>('local');
  const [roomInfo, setRoomInfo] = useState<{ roomId: string; playerId: string } | null>(null);

  const handleJoinRoom = (roomId: string, playerId: string) => {
    setRoomInfo({ roomId, playerId });
    setMode('multiplayer');
  };

  const handleLeaveRoom = () => {
    setRoomInfo(null);
    setMode('lobby');
  };

  if (mode === 'multiplayer' && roomInfo) {
    return (
      <MultiplayerGameBoard
        roomId={roomInfo.roomId}
        playerId={roomInfo.playerId}
        onLeave={handleLeaveRoom}
      />
    );
  }

  if (mode === 'lobby') {
    return <RoomLobby onJoinRoom={handleJoinRoom} />;
  }

  // 本地游戏模式
  return (
    <div>
      <div style={{
        position: 'fixed',
        top: 10,
        right: 10,
        zIndex: 100,
        display: 'flex',
        gap: 10,
      }}>
        <button
          onClick={() => setMode('lobby')}
          style={{
            padding: '8px 16px',
            backgroundColor: '#3498db',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          多人对战
        </button>
      </div>
      <GameBoard />
    </div>
  );
}
