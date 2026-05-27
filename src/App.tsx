import { useState } from 'react';
import { GameBoard } from './components/GameBoard';
import { RoomLobby } from './components/RoomLobby';
import { MultiplayerGameBoard } from './components/MultiplayerGameBoard';
import { ReplayBoard } from './components/ReplayBoard';
import type { GameLog } from '../shared/log';

type ViewMode = 'local' | 'lobby' | 'multiplayer';

export function App() {
  const [mode, setMode] = useState<ViewMode>('local');
  const [roomInfo, setRoomInfo] = useState<{ roomId: string; playerId: string } | null>(null);
  const [replayLog, setReplayLog] = useState<GameLog | null>(null);

  const handleJoinRoom = (roomId: string, playerId: string) => {
    setRoomInfo({ roomId, playerId });
    setMode('multiplayer');
  };

  const handleLeaveRoom = () => {
    setRoomInfo(null);
    setMode('lobby');
  };

  const handleLoadLog = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result as string);
            setReplayLog(data as GameLog);
          } catch {
            alert('无效的日志文件');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  if (replayLog) {
    return <ReplayBoard log={replayLog} onExit={() => setReplayLog(null)} />;
  }

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
      }}
      >
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
        <button
          onClick={handleLoadLog}
          style={{
            padding: '8px 16px',
            backgroundColor: '#9b59b6',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          回放
        </button>
      </div>
      <GameBoard />
    </div>
  );
}
