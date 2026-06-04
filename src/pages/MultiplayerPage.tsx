import { css } from '@linaria/core';
import { useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { MultiplayerGameBoard } from '../components/MultiplayerGameBoard';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { colors } from '../theme';

const errorText = css`
  color: ${colors.text.primary};
  padding: 40px;
  text-align: center;
`;

export function MultiplayerPage() {
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const [resetKey, setResetKey] = useState<string>(roomId ?? 'init');

  if (!roomId) {
    return <div className={errorText}>无效的房间ID</div>;
  }

  return (
    <ErrorBoundary
      context="game-board"
      resetKey={resetKey}
      onReset={() => setResetKey(`${roomId}:${Date.now()}`)}
    >
      <MultiplayerGameBoard roomId={roomId} onLeave={() => navigate('/lobby')} />
    </ErrorBoundary>
  );
}
