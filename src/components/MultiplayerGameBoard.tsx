import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { GameView, GameAction } from '../../engine/v2/types';
import { PlayerPanel } from './PlayerPanel';
import { HandCards } from './HandCards';
import { ActionPanel } from './ActionPanel';
import { colors, styles } from '../theme';

interface MultiplayerGameBoardProps {
  roomId: string;
  onLeave: () => void;
}

export function MultiplayerGameBoard({ roomId, onLeave }: MultiplayerGameBoardProps) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected, lastMessage, send, connect } = useWebSocket(wsUrl);

  const [gameView, setGameView] = useState<GameView | null>(null);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>(['等待游戏开始...']);
  const [error, setError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<{ winner: string } | null>(null);

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (connected) {
      send({ type: 'join_room', roomId });
    }
  }, [connected, roomId, send]);

  useEffect(() => {
    if (!lastMessage) return;

    const message = lastMessage;

    switch (message.type) {
      case 'gameView':
        setGameView(message.view);
        break;

      case 'events':
        break;

      case 'gameOver':
        setGameOver({ winner: message.winner });
        setLog(prev => [...prev, `游戏结束！${message.winner}获胜！`]);
        break;

      case 'error':
        setError(message.message);
        setTimeout(() => setError(null), 3000);
        break;

      case 'player_joined':
        setLog(prev => [...prev, `玩家 ${message.playerId} 加入`]);
        break;

      case 'player_left':
        setLog(prev => [...prev, `玩家 ${message.playerId} 离开`]);
        break;

      case 'game_started':
        setLog(prev => [...prev, '游戏开始！']);
        break;
    }
  }, [lastMessage]);

  const isMyTurn = gameView?.state.self === gameView?.state.currentPlayer;

  const sendAction = useCallback((action: GameAction) => {
    send({ type: 'action', action });
    setSelectedCard(null);
  }, [send]);

  const handlePlayCard = useCallback(() => {
    if (selectedCard === null || !gameView || !isMyTurn) return;

    const myPlayer = gameView.state.players[gameView.state.self];
    if (!myPlayer) return;

    const card = myPlayer.hand[selectedCard];
    if (!card) return;

    const playAction = gameView.actions.find(a => a.type === 'playCard');
    const cardEntry = playAction?.type === 'playCard' ? playAction.cards.find(c => c.cardId === card.id) : undefined;
    const target = cardEntry?.targets.length ? cardEntry.targets[0] : undefined;

    sendAction({ type: 'playCard', player: gameView.state.self, cardId: card.id, target });
  }, [selectedCard, gameView, isMyTurn, sendAction]);

  const handleEndTurn = useCallback(() => {
    if (!gameView || !isMyTurn) return;
    sendAction({ type: 'endTurn', player: gameView.state.self });
  }, [gameView, isMyTurn, sendAction]);

  const handleLeave = useCallback(() => {
    send({ type: 'leave_room' });
    onLeave();
  }, [send, onLeave]);

  if (!gameView) {
    return (
      <div style={{
        padding: 40,
        backgroundColor: colors.bg.page,
        minHeight: '100vh',
        color: colors.text.primary,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
      >
        <div style={{ textAlign: 'center' }}>
          <h2>等待游戏开始...</h2>
          <p style={{ color: colors.text.muted }}>房间号: {roomId}</p>
          <button
            onClick={handleLeave}
            style={{
              padding: '10px 24px',
              backgroundColor: colors.text.dim,
              color: colors.white,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              marginTop: 20,
            }}
          >
            离开房间
          </button>
        </div>
      </div>
    );
  }

  const { state: view } = gameView;
  const myPlayer = view.players[view.self];
  const playerNames = Object.keys(view.players);

  return (
    <div style={styles.page()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>三国杀 - 房间 {roomId}</h1>
        <button
          onClick={handleLeave}
          style={styles.btn(colors.text.dim, { padding: '8px 16px' })}
        >
          离开
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 30, flexWrap: 'wrap' }}>
        {playerNames.map((name) => {
          const player = view.players[name];
          return (
            <PlayerPanel
              key={name}
              playerName={name}
              player={{
                info: {
                  name,
                  characterId: player.characterId,
                  role: player.role,
                  alive: player.alive,
                  gender: player.gender,
                  faction: player.faction,
                },
                health: player.health,
                maxHealth: player.maxHealth,
                hand: player.hand.map(c => c.id),
                equipment: {
                  weapon: player.equipment.weapon?.id,
                  armor: player.equipment.armor?.id,
                  horsePlus: player.equipment.horsePlus?.id,
                  horseMinus: player.equipment.horseMinus?.id,
                },
                pendingTricks: [],
                vars: player.vars,
                tags: [],
              }}
              cardMap={Object.fromEntries(player.hand.map(c => [c.id, c]))}
              isCurrentPlayer={name === view.currentPlayer}
              isSelf={name === view.self}
            />
          );
        })}
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <span>阶段: {view.phase} | 当前玩家: {view.currentPlayer}</span>
        {isMyTurn && <span style={{ color: colors.accent.green, marginLeft: 10 }}>- 你的回合！</span>}
      </div>

      {myPlayer && (
        <div style={{ marginBottom: 20 }}>
          <HandCards
            hand={myPlayer.hand}
            selectedIndex={selectedCard}
            onSelectCard={(index) => setSelectedCard(index === -1 ? null : index)}
          />
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <ActionPanel
          canPlay={selectedCard !== null && isMyTurn && view.phase === '出牌'}
          canEndTurn={isMyTurn && view.phase === '出牌'}
          onPlayCard={handlePlayCard}
          onEndTurn={handleEndTurn}
        />
      </div>

      <div style={styles.logContainer()}>
        {log.map((msg, i) => (
          <div key={i} style={{ fontSize: 13, color: colors.text.secondary, marginBottom: 2 }}>{msg}</div>
        ))}
      </div>

      {gameOver && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.overlay,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
        }}
        >
          <div style={{
            backgroundColor: colors.bg.panel,
            borderRadius: 12,
            padding: 40,
            textAlign: 'center',
          }}
          >
            <h2 style={{ marginBottom: 20 }}>游戏结束！</h2>
            <p style={{ fontSize: 24, color: colors.accent.gold, marginBottom: 30 }}>{gameOver.winner} 获胜！</p>
            <button
              onClick={handleLeave}
              style={styles.btn(colors.accent.blue, { padding: '12px 32px', fontSize: 16 })}
            >
              返回大厅
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={styles.errorToast()}>
          {error}
        </div>
      )}

      {!connected && (
        <div style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          backgroundColor: colors.accent.red,
          padding: '10px 20px',
          borderRadius: 6,
        }}
        >
          连接断开，正在重连...
        </div>
      )}
    </div>
  );
}
