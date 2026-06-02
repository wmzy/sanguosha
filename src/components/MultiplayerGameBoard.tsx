// src/components/MultiplayerGameBoard.tsx — 多人模式游戏棋盘
//
// 数据流：服务器发 initialView 初始化本地 FrontendState，events 通过 reducer 应用。
// 此处使用简化渲染（不依赖 PlayerPanel 组件）以避免与 PlayerState 类型耦合。
// 后续可重做 UI 适配 PlayerView。

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { FrontendState, CardInfo } from '../../engine/view/types';
import { reduceFrontend } from '../../engine/view/reducer';
import { colors, styles } from '../theme';

interface MultiplayerGameBoardProps {
  roomId: string;
  onLeave: () => void;
}

export function MultiplayerGameBoard({ roomId, onLeave }: MultiplayerGameBoardProps) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected, lastMessage, send, connect } = useWebSocket(wsUrl);

  const [feState, setFeState] = useState<FrontendState | null>(null);
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
      case 'initialView':
        setFeState(message.state);
        break;
      case 'events':
        setFeState(prev => (prev ? reduceFrontend(prev, message.events) : prev));
        break;
      case 'gameOver':
        setGameOver({ winner: message.winner });
        setLog(prev => [...prev, `游戏结束！${message.winner} 获胜！`]);
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
      case 'player_disconnected':
        setLog(prev => [...prev, `玩家 ${message.playerId} 断线（${Math.round(message.graceMs / 1000)}s 宽限期）`]);
        break;
      case 'player_reconnected':
        setLog(prev => [...prev, `玩家 ${message.playerId} 重连`]);
        break;
      case 'game_started':
        setLog(prev => [...prev, '游戏开始！']);
        break;
    }
  }, [lastMessage]);

  const handleLeave = useCallback(() => {
    send({ type: 'leave_room' });
    onLeave();
  }, [send, onLeave]);

  if (!feState) {
    return (
      <div style={styles.page()}>
        <div style={{ textAlign: 'center' }}>
          <h2>等待游戏开始...</h2>
          <p style={{ color: colors.text.muted }}>房间号: {roomId}</p>
          <button
            onClick={handleLeave}
            style={styles.btn(colors.text.dim, { padding: '10px 24px' })}
          >
            离开房间
          </button>
        </div>
      </div>
    );
  }

  const view = feState.view;
  const myId = feState.myPlayerId;
  const allPlayerNames = [myId, ...Object.keys(view.others)];

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
        {allPlayerNames.map((name) => {
          const isSelf = name === myId;
          const health = isSelf ? view.self.health : view.others[name]?.health ?? 0;
          const maxHealth = isSelf ? view.self.maxHealth : view.others[name]?.maxHealth ?? 0;
          const alive = isSelf ? view.self.alive : view.others[name]?.alive ?? true;
          return (
            <div
              key={name}
              style={{
                backgroundColor: isSelf ? colors.bg.playerSelf : colors.bg.playerOther,
                borderRadius: 8,
                padding: 12,
                minWidth: 120,
                textAlign: 'center',
                border: name === view.turn.currentPlayer ? `2px solid ${colors.accent.gold}` : 'none',
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                {name}{isSelf ? '（你）' : ''}
              </div>
              <div style={{ color: alive ? colors.text.primary : colors.accent.red }}>
                {health}/{maxHealth} HP
              </div>
              {!alive && <div style={{ color: colors.accent.red, fontSize: 12 }}>阵亡</div>}
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <span>阶段: {view.turn.phase} | 当前玩家: {view.turn.currentPlayer}</span>
        {view.turn.currentPlayer === myId && (
          <span style={{ color: colors.accent.green, marginLeft: 10 }}>- 你的回合！</span>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3>我的手牌</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {view.self.hand.map((card: CardInfo) => (
            <div
              key={card.id}
              style={{
                backgroundColor: colors.bg.panel,
                padding: '6px 10px',
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              {card.name} {card.suit}{card.rank}
            </div>
          ))}
        </div>
      </div>

      {view.pending && (
        <div
          style={{
            backgroundColor: colors.accent.darkRed,
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 'bold' }}>等待操作：{view.pending.type}</div>
        </div>
      )}

      <div style={styles.logContainer()}>
        {log.map((msg, i) => (
          <div key={i} style={{ fontSize: 13, color: colors.text.secondary, marginBottom: 2 }}>{msg}</div>
        ))}
      </div>

      {gameOver && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overlay, display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: colors.bg.panel, borderRadius: 12, padding: 40, textAlign: 'center' }}>
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
        <div style={{ position: 'fixed', bottom: 20, right: 20, backgroundColor: colors.accent.red, padding: '10px 20px', borderRadius: 6 }}>
          连接断开，正在重连...
        </div>
      )}
    </div>
  );
}
