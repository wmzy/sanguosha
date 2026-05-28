import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { GameBoard } from './components/GameBoard';
import { RoomLobby } from './components/RoomLobby';
import { ReplayBoard } from './components/ReplayBoard';
import { useState, useCallback } from 'react';
import type { GameLog } from '../shared/log';

function HomePage() {
  const [replayLog, setReplayLog] = useState<GameLog | null>(null);

  const handleLoadLog = useCallback(() => {
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
  }, []);

  if (replayLog) {
    return <ReplayBoard log={replayLog} onExit={() => setReplayLog(null)} />;
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#1a1a2e',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#eee',
    }}
    >
      <h1 style={{ fontSize: 48, marginBottom: 8 }}>三国杀</h1>
      <p style={{ color: '#95a5a6', marginBottom: 40 }}>数字卡牌游戏</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 280 }}>
        <Link to="/game" style={linkBtnStyle('#e74c3c')}>
          本地游戏
        </Link>
        <Link to="/lobby" style={linkBtnStyle('#3498db')}>
          多人对战
        </Link>
        <button onClick={handleLoadLog} style={btnStyle('#9b59b6')}>
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
        <span style={{ color: '#95a5a6' }}>多人对战</span>
      </nav>
      <RoomLobby onJoinRoom={handleJoinRoom} />
    </div>
  );
}

function MultiplayerPage() {
  const navigate = useNavigate();
  // roomId comes from URL params, playerId from location state
  // For now, use a simplified approach

  return (
    <div>
      <nav style={navStyle}>
        <button onClick={() => navigate('/lobby')} style={navLinkStyle}>
          ← 离开房间
        </button>
      </nav>
      <div style={{ color: '#eee', padding: 40, textAlign: 'center' }}>
        多人游戏（需要通过大厅加入）
      </div>
    </div>
  );
}

function LocalGamePage() {
  return (
    <div>
      <nav style={navStyle}>
        <Link to="/" style={navLinkStyle}>← 返回</Link>
        <span style={{ color: '#95a5a6' }}>本地游戏</span>
      </nav>
      <GameBoard />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/game" element={<LocalGamePage />} />
        <Route path="/lobby" element={<LobbyPage />} />
        <Route path="/game/:roomId" element={<MultiplayerPage />} />
      </Routes>
    </BrowserRouter>
  );
}

const linkBtnStyle = (bg: string): React.CSSProperties => ({
  display: 'block',
  padding: '14px 24px',
  backgroundColor: bg,
  color: 'white',
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
  color: 'white',
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
  backgroundColor: '#16213e',
  borderBottom: '1px solid #34495e',
};

const navLinkStyle: React.CSSProperties = {
  color: '#3498db',
  textDecoration: 'none',
  fontSize: 14,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};
