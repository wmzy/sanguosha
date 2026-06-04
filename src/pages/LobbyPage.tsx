import { useCallback } from 'react';
import { css } from '@linaria/core';
import { Link, useNavigate } from 'react-router-dom';
import { RoomLobby } from '../components/RoomLobby';
import { colors } from '../theme';

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

export function LobbyPage() {
  const navigate = useNavigate();

  const handleJoinRoom = useCallback(
    (roomId: string, playerId: string) => {
      navigate(`/game/${roomId}`, { state: { playerId } });
    },
    [navigate],
  );

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
