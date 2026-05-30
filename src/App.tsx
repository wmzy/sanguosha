import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { GameBoard } from './components/GameBoard';
import { RoomLobby } from './components/RoomLobby';
import { ReplayBoard } from './components/ReplayBoard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useState, useCallback } from 'react';
import { loadState } from './utils/logFile';
import type { GameState } from '../engine/v2/types';
import { colors, styles } from './theme';

function HomePage() {
  const [replayState, setReplayState] = useState<GameState | null>(null);

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

  if (replayState) {
    return <ReplayBoard onExit={() => setReplayState(null)} />;
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: colors.bg.page,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: colors.text.primary,
    }}
    >
      <h1 style={{ fontSize: 48, marginBottom: 8 }}>三国杀</h1>
      <p style={{ color: colors.text.muted, marginBottom: 40 }}>数字卡牌游戏</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 280 }}>
        <Link to="/game" style={linkBtnStyle(colors.accent.orange)}>
          调试游戏
        </Link>
        <Link to="/lobby" style={linkBtnStyle(colors.accent.blue)}>
          多人对战
        </Link>
        <button onClick={handleLoadLog} style={btnStyle(colors.accent.purpleLight)}>
          回放
        </button>
      </div>
    </div>
  );
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

  return (
    <div>
      <nav style={navStyle}>
        <button onClick={() => navigate('/lobby')} style={navLinkStyle}>
          ← 离开房间
        </button>
      </nav>
      <div style={{ color: colors.text.primary, padding: 40, textAlign: 'center' }}>
        多人游戏（需要通过大厅加入）
      </div>
    </div>
  );
}

function DebugGamePage() {
  return (
    <div>
      <nav style={navStyle}>
        <Link to="/" style={navLinkStyle}>← 返回</Link>
        <span style={{ color: colors.text.muted }}>调试游戏</span>
      </nav>
      <GameBoard />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/game" element={<DebugGamePage />} />
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
