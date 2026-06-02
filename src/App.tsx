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

  const statusLabel = (status: RoomInfo['status']) => {
    switch (status) {
      case '等待中': return { text: '等待', color: colors.accent.amber };
      case '进行中': return { text: '游戏中', color: colors.accent.green };
      case '已结束': return { text: '已结束', color: colors.text.muted };
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: colors.bg.page,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      color: colors.text.primary,
      padding: '60px 20px 40px',
    }}
    >
      <h1 style={{ fontSize: 48, marginBottom: 8, letterSpacing: 4 }}>三国杀</h1>
      <p style={{ color: colors.text.muted, marginBottom: 40 }}>数字卡牌游戏</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 280 }}>
        <Link to="/debug" style={linkBtnStyle(colors.accent.orange)}>
          调试游戏
        </Link>
        <Link to="/lobby" style={linkBtnStyle(colors.accent.blue)}>
          多人对战
        </Link>
        <button onClick={handleLoadLog} style={btnStyle(colors.accent.purpleLight)}>
          回放
        </button>
      </div>

      {rooms.length > 0 && (
        <div style={{ marginTop: 48, width: '100%', maxWidth: 600 }}>
          <h2 style={{ fontSize: 18, marginBottom: 16, color: colors.text.secondary, textAlign: 'center' }}>
            房间列表
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rooms.map(room => {
              const st = statusLabel(room.status);
              return (
                <div
                  key={room.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: colors.bg.panel,
                    borderRadius: 8,
                    padding: '12px 16px',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                    <span style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 4,
                      backgroundColor: st.color,
                      color: colors.white,
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                    }}
                    >
                      {st.text}
                    </span>
                    <span style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {room.name}
                    </span>
                    <span style={{ color: colors.text.dim, fontSize: 13, whiteSpace: 'nowrap' }}>
                      {room.playerCount}/{room.maxPlayers}
                    </span>
                    <span style={{ color: colors.text.dim, fontSize: 12, fontFamily: 'monospace' }}>
                      {room.id}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <Link
                      to={`/debug/${room.id}`}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: colors.accent.blue,
                        color: colors.white,
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 'bold',
                        textDecoration: 'none',
                      }}
                    >
                      进入
                    </Link>
                    <button
                      onClick={() => handleDeleteRoom(room.id)}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: colors.accent.red,
                        color: colors.white,
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 'bold',
                      }}
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
      <nav style={navStyle}>
        <Link to="/" style={navLinkStyle}>← 返回</Link>
        <span style={{ color: colors.text.muted }}>多人对战</span>
      </nav>
      <RoomLobby onJoinRoom={handleJoinRoom} />
    </div>
  );
}

function MultiplayerPage() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();

  if (!roomId) {
    return (
      <div style={{ color: colors.text.primary, padding: 40, textAlign: 'center' }}>
        无效的房间ID
      </div>
    );
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

const linkBtnStyle = (bg: string): React.CSSProperties => ({
  display: 'block',
  padding: '14px 24px',
  backgroundColor: bg,
  color: colors.white,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 'bold',
  textAlign: 'center',
  textDecoration: 'none',
});

const btnStyle = (bg: string): React.CSSProperties => ({
  display: 'block',
  width: '100%',
  padding: '14px 24px',
  backgroundColor: bg,
  color: colors.white,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 'bold',
});

const navStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '12px 20px',
  backgroundColor: colors.bg.nav,
  borderBottom: `1px solid ${colors.bg.input}`,
};

const navLinkStyle: React.CSSProperties = {
  color: colors.accent.blue,
  textDecoration: 'none',
  fontSize: 14,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};
