// src/components/MultiplayerGameBoard.tsx
import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { PublicGameState, PlayerAction } from '../../shared/types';
import { PlayerPanel } from './PlayerPanel';
import { HandCards } from './HandCards';
import { ActionPanel } from './ActionPanel';

interface MultiplayerGameBoardProps {
  roomId: string;
  playerId: string;
  onLeave: () => void;
}

export function MultiplayerGameBoard({ roomId, playerId: _playerId, onLeave }: MultiplayerGameBoardProps) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected, lastMessage, send, connect } = useWebSocket(wsUrl);

  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>(['游戏开始！']);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<{ winner: string } | null>(null);

  // 连接并加入房间
  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (connected) {
      send({ type: 'join_room', roomId });
    }
  }, [connected, roomId, send]);

  // 处理消息
  useEffect(() => {
    if (!lastMessage) return;

    const message = lastMessage;

    switch (message.type) {
      case 'state_update':
        setGameState(message.state);
        break;

      case 'your_turn':
        setIsMyTurn(true);
        setLog(prev => [...prev, `轮到你的回合 (${message.phase})`]);
        break;

      case 'game_started':
        setLog(prev => [...prev, '游戏开始！']);
        break;

      case 'game_over':
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
    }
  }, [lastMessage]);

  // 获取当前玩家信息
  const myPlayer = gameState?.players.find(p => {
    // 通过位置匹配，因为playerId和playerName不同
    const index = gameState.players.indexOf(p);
    return index === 0; // 简化：假设第一个玩家是自己
  });

  const handlePlayCard = useCallback(() => {
    if (selectedCard === null || !myPlayer || !isMyTurn) return;

    const card = myPlayer.hand?.[selectedCard];
    if (!card) return;

    const action: PlayerAction = {
      type: '出牌',
      card,
      target: gameState?.players.find(p => p.name !== myPlayer.name && p.alive)?.name,
    };

    send({ type: 'action', action });
    setSelectedCard(null);
    setIsMyTurn(false);
  }, [selectedCard, myPlayer, isMyTurn, gameState, send]);

  const handleEndTurn = useCallback(() => {
    if (!isMyTurn) return;

    const action: PlayerAction = { type: '结束回合' };
    send({ type: 'action', action });
    setIsMyTurn(false);
  }, [isMyTurn, send]);

  const handleLeave = useCallback(() => {
    send({ type: 'leave_room' });
    onLeave();
  }, [send, onLeave]);

  if (!gameState) {
    return (
      <div style={{
        padding: 40,
        backgroundColor: '#1a1a2e',
        minHeight: '100vh',
        color: '#eee',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
      >
        <div style={{ textAlign: 'center' }}>
          <h2>等待游戏开始...</h2>
          <p style={{ color: '#95a5a6' }}>房间号: {roomId}</p>
          <button
            onClick={handleLeave}
            style={{
              padding: '10px 24px',
              backgroundColor: '#7f8c8d',
              color: 'white',
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

  return (
    <div style={{ padding: 20, backgroundColor: '#1a1a2e', minHeight: '100vh', color: '#eee' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>三国杀 - 房间 {roomId}</h1>
        <button
          onClick={handleLeave}
          style={{
            padding: '8px 16px',
            backgroundColor: '#7f8c8d',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          离开
        </button>
      </div>

      {/* 玩家面板 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 30, flexWrap: 'wrap' }}>
        {gameState.players.map((player, index) => (
          <PlayerPanel
            key={player.name}
            player={{
              ...player,
              hand: player.hand ?? [],
            }}
            isCurrentPlayer={player.name === gameState.currentPlayer}
            isSelf={index === 0} // 简化：第一个玩家是自己
          />
        ))}
      </div>

      {/* 游戏信息 */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <span>回合 {gameState.round} | 阶段: {gameState.phase} | 当前玩家: {gameState.currentPlayer}</span>
        {isMyTurn && <span style={{ color: '#2ecc71', marginLeft: 10 }}>- 你的回合！</span>}
      </div>

      {/* 手牌 */}
      {myPlayer?.hand && (
        <div style={{ marginBottom: 20 }}>
          <HandCards
            hand={myPlayer.hand}
            selectedIndex={selectedCard}
            onSelectCard={(index) => setSelectedCard(index === -1 ? null : index)}
          />
        </div>
      )}

      {/* 操作面板 */}
      <div style={{ marginBottom: 20 }}>
        <ActionPanel
          canPlay={selectedCard !== null && isMyTurn && gameState.phase === '出牌'}
          canEndTurn={isMyTurn && gameState.phase === '出牌'}
          onPlayCard={handlePlayCard}
          onEndTurn={handleEndTurn}
        />
      </div>

      {/* 日志 */}
      <div style={{
        maxHeight: 200,
        overflow: 'auto',
        backgroundColor: '#2c3e50',
        borderRadius: 8,
        padding: 12,
      }}
      >
        {log.map((msg, i) => (
          <div key={i} style={{ fontSize: 13, color: '#bdc3c7', marginBottom: 2 }}>{msg}</div>
        ))}
      </div>

      {/* 游戏结束 */}
      {gameOver && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
        }}
        >
          <div style={{
            backgroundColor: '#2c3e50',
            borderRadius: 12,
            padding: 40,
            textAlign: 'center',
          }}
          >
            <h2 style={{ marginBottom: 20 }}>游戏结束！</h2>
            <p style={{ fontSize: 24, color: '#f1c40f', marginBottom: 30 }}>{gameOver.winner} 获胜！</p>
            <button
              onClick={handleLeave}
              style={{
                padding: '12px 32px',
                backgroundColor: '#3498db',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              返回大厅
            </button>
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div style={{
          position: 'fixed',
          top: 20,
          right: 20,
          backgroundColor: '#e74c3c',
          padding: '15px 25px',
          borderRadius: 8,
          zIndex: 1000,
        }}
        >
          {error}
        </div>
      )}

      {/* 连接状态 */}
      {!connected && (
        <div style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          backgroundColor: '#e74c3c',
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
