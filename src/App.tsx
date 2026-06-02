import { css } from '@linaria/core';
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';
import { DebugLobby } from './components/DebugLobby';
import { RoomLobby } from './components/RoomLobby';
import { MultiplayerGameBoard } from './components/MultiplayerGameBoard';
import { ReplayBoard } from './components/ReplayBoard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useState, useCallback, useEffect } from 'react';
import { loadState } from './utils/logFile';
import type { GameState } from '../engine/types';
import { colors } from './theme';
import type { RoomInfo } from '../server/protocol';

const page = css`
  min-height: 100vh;
  background-color: ${colors.bg.page};
  display: flex;
  flex-direction: column;
  align-items: center;
  color: ${colors.text.primary};
  padding: 60px 20px 40px;
`;

const title = css`
  font-size: 48px;
  margin: 0 0 8px;
  letter-spacing: 4px;
`;

const subtitle = css`
  color: ${colors.text.muted};
  margin: 0 0 40px;
`;

const actionList = css`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 280px;
`;

const linkButtonBase = css`
  display: block;
  padding: 14px 24px;
  color: ${colors.white};
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  text-align: center;
  text-decoration: none;
`;

const linkOrange = css`
  background-color: ${colors.accent.orange};
`;

const linkBlue = css`
  background-color: ${colors.accent.blue};
`;

const buttonPurple = css`
  background-color: ${colors.accent.purpleLight};
  width: 100%;
`;

const roomSection = css`
  margin-top: 48px;
  width: 100%;
  max-width: 600px;
`;

const roomSectionTitle = css`
  font-size: 18px;
  margin: 0 0 16px;
  color: ${colors.text.secondary};
  text-align: center;
`;

const roomList = css`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const roomRow = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: ${colors.bg.panel};
  border-radius: 8px;
  padding: 12px 16px;
  gap: 12px;
`;

const roomInfo = css`
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
`;

const roomBadge = (color: string) => css`
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background-color: ${color};
  color: ${colors.white};
  font-weight: bold;
  white-space: nowrap;
`;

const roomName = css`
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const roomMeta = css`
  color: ${colors.text.dim};
  font-size: 13px;
  white-space: nowrap;
`;

const roomId = css`
  color: ${colors.text.dim};
  font-size: 12px;
  font-family: monospace;
`;

const roomActions = css`
  display: flex;
  gap: 8px;
  flex-shrink: 0;
`;

const enterLink = css`
  padding: 6px 14px;
  background-color: ${colors.accent.blue};
  color: ${colors.white};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: bold;
  text-decoration: none;
`;

const deleteBtn = css`
  padding: 6px 14px;
  background-color: ${colors.accent.red};
  color: ${colors.white};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: bold;
`;

const navBar = css`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background-color: ${colors.bg.nav};
  border-bottom: 1px solid ${colors.bg.input};
`;

const navLink = css`
  color: ${colors.accent.blue};
  text-decoration: none;
  font-size: 14px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
`;

const navText = css`
  color: ${colors.text.muted};
`;

const errorText = css`
  color: ${colors.text.primary};
  padding: 40px;
  text-align: center;
`;

const statusLabel = (status: RoomInfo['status']): { text: string; color: string } => {
  switch (status) {
    case '等待中': return { text: '等待', color: colors.accent.amber };
    case '进行中': return { text: '游戏中', color: colors.accent.green };
    case '已结束': return { text: '已结束', color: colors.text.muted };
  }
};

function HomePage() {
  const [replayState, setReplayState] = useState<GameState | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);

  const refreshRooms = useCallback(() => {
    fetch('/api/rooms')
      .then(res => res.json())
      .then((data: RoomInfo[]) => setRooms(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshRooms();
    const id = setInterval(refreshRooms, 5000);
    return () => clearInterval(id);
  }, [refreshRooms]);

  const handleLoadLog = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const data = await loadState(file);
          setReplayState(data);
        } catch {
          alert('无效的日志文件');
        }
      }
    };
    input.click();
  }, []);

  const handleDeleteRoom = useCallback((roomId: string) => {
    fetch(`/api/rooms/${roomId}`, { method: 'DELETE' })
      .then(res => { if (res.ok) refreshRooms(); })
      .catch(() => {});
  }, [refreshRooms]);

  if (replayState) {
    return <ReplayBoard onExit={() => setReplayState(null)} />;
  }

  return (
    <div className={page}>
      <h1 className={title}>三国杀</h1>
      <p className={subtitle}>数字卡牌游戏</p>

      <div className={actionList}>
        <Link to="/debug" className={`${linkButtonBase} ${linkOrange}`}>
          调试游戏
        </Link>
        <Link to="/lobby" className={`${linkButtonBase} ${linkBlue}`}>
          多人对战
        </Link>
        <button type="button" onClick={handleLoadLog} className={`${linkButtonBase} ${buttonPurple}`}>
          回放
        </button>
      </div>

      {rooms.length > 0 && (
        <div className={roomSection}>
          <h2 className={roomSectionTitle}>房间列表</h2>
          <div className={roomList}>
            {rooms.map(room => {
              const st = statusLabel(room.status);
              return (
                <div key={room.id} className={roomRow}>
                  <div className={roomInfo}>
                    <span className={roomBadge(st.color)}>{st.text}</span>
                    <span className={roomName}>{room.name}</span>
                    <span className={roomMeta}>{room.playerCount}/{room.maxPlayers}</span>
                    <span className={roomId}>{room.id}</span>
                  </div>
                  <div className={roomActions}>
                    <Link to={`/debug/${room.id}`} className={enterLink}>
                      进入
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDeleteRoom(room.id)}
                      className={deleteBtn}
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DebugPage() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId?: string }>();
  return <DebugLobby onExit={() => navigate('/')} initialRoomId={roomId} />;
}

function LobbyPage() {
  const navigate = useNavigate();

  const handleJoinRoom = (roomId: string, playerId: string) => {
    navigate(`/game/${roomId}`, { state: { playerId } });
  };

  return (
    <div>
      <nav className={navBar}>
        <Link to="/" className={navLink}>← 返回</Link>
        <span className={navText}>多人对战</span>
      </nav>
      <RoomLobby onJoinRoom={handleJoinRoom} />
    </div>
  );
}

function MultiplayerPage() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();

  if (!roomId) {
    return <div className={errorText}>无效的房间ID</div>;
  }

  return <MultiplayerGameBoard roomId={roomId} onLeave={() => navigate('/lobby')} />;
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/debug" element={<DebugPage />} />
          <Route path="/debug/:roomId" element={<DebugPage />} />
          <Route path="/lobby" element={<LobbyPage />} />
          <Route path="/game/:roomId" element={<MultiplayerPage />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
