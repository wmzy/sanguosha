// src/components/MultiplayerGameBoard.tsx — 多人模式游戏棋盘
//
// 新 ENGINE-DESIGN: 服务器发 GameView(initialView),客户端发 ClientMessage。
import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { GameViewComponent } from './GameView';
import { styles } from '../theme';
import type { GameView, Json } from '../../engine/types';
import type { ServerMessage } from '../../server/protocol';

interface ActionMsg {
  skillId: string;
  actionType: string;
  ownerId: string;
  params: Record<string, Json>;
}

interface MultiplayerGameBoardProps {
  roomId: string;
  onLeave: () => void;
}

export function MultiplayerGameBoard({ roomId, onLeave }: MultiplayerGameBoardProps) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected, send, onMessage } = useWebSocket(wsUrl);

  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<{ winner: string } | null>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (connected) send({ type: 'join_room', roomId });
  }, [connected, roomId, send]);

  useEffect(() => {
    const unsubscribe = onMessage((msg: ServerMessage) => {
      if (msg.type === 'initialView') {
        lastSeqRef.current = msg.lastSeq;
        setView(msg.state);
      } else if (msg.type === 'gameOver') {
        setGameOver({ winner: msg.winner });
      } else if (msg.type === 'error') {
        setError(msg.message);
        setTimeout(() => setError(null), 3000);
      }
    });
    return unsubscribe;
  }, [onMessage]);

  const sendAction = useCallback(
    (action: ActionMsg) => {
      send({ type: 'action', action: { ...action, baseSeq: lastSeqRef.current }, baseSeq: lastSeqRef.current });
    },
    [send],
  );

  const handleLeave = useCallback(() => {
    send({ type: 'leave_room' });
    onLeave();
  }, [send, onLeave]);

  if (!view) {
    return (
      <div style={styles.page()}>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <h2>等待游戏开始...</h2>
          <p style={{ color: '#888' }}>
            {connected ? '已连接,等待其他玩家加入' : '连接中...'}
          </p>
          <button style={styles.btn('#555')} onClick={handleLeave}>离开房间</button>
          {error && <div style={styles.errorToast()}>{error}</div>}
        </div>
      </div>
    );
  }

  if (gameOver) {
    return (
      <div style={styles.page()}>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <h2>游戏结束</h2>
          <p style={{ fontSize: 18, color: '#ffd700' }}>胜者: {gameOver.winner}</p>
          <button style={styles.btn('#555')} onClick={handleLeave}>返回大厅</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <GameViewComponent
        view={view}
        onAction={sendAction}
        onDeleteRoom={handleLeave}
      />
      {error && <div style={styles.errorToast()}>{error}</div>}
    </div>
  );
}
