// src/components/MultiplayerGameBoard.tsx — 多人模式游戏棋盘
//
// 数据流：服务器发 initialView 初始化本地 FrontendState，events 通过 reducer 应用。
// 面板渲染走 PlayerPanel：self 玩家用完整 SelfView，others 用 OtherPlayerView 摘要。
// 状态由本地 useState 维护（log / error / gameOver），游戏状态由 FrontendState 派生。
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { FrontendState, CardInfo } from '../../engine/view/types';
import { reduceFrontend } from '../../engine/view/reducer';
import { PlayerPanel, type PlayerPanelData } from './PlayerPanel';
import { colors, styles } from '../theme';

interface MultiplayerGameBoardProps {
  roomId: string;
  onLeave: () => void;
}

export function MultiplayerGameBoard({ roomId, onLeave }: MultiplayerGameBoardProps) {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected, send, onMessage, connect } = useWebSocket(wsUrl);

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
    const unsubscribe = onMessage((message) => {
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
    });
    return unsubscribe;
  }, [onMessage]);

  const handleLeave = useCallback(() => {
    send({ type: 'leave_room' });
    onLeave();
  }, [send, onLeave]);

  // 自/他 玩家面板数据：self 用 SelfView（完整手牌），others 用 OtherPlayerView（摘要）
  const playerPanels = useMemo<{ name: string; data: PlayerPanelData }[]>(() => {
    if (!feState) return [];
    const view = feState.view;
    const myId = feState.myPlayerId;
    const result: { name: string; data: PlayerPanelData }[] = [];

    result.push({
      name: myId,
      data: { kind: 'self', data: view.self },
    });

    for (const otherId of Object.keys(view.others)) {
      const other = view.others[otherId];
      if (!other) continue;
      result.push({
        name: otherId,
        data: { kind: 'other', data: other },
      });
    }
    return result;
  }, [feState]);

  if (!feState) {
    return (
      <div style={styles.page()}>
        <div style={{ textAlign: 'center' }}>
          <h2>等待游戏开始...</h2>
          <p style={{ color: colors.text.muted }}>房间号: {roomId}</p>
          <button onClick={handleLeave} style={styles.btn(colors.text.dim)}>
            离开房间
          </button>
        </div>
      </div>
    );
  }

  const view = feState.view;
  const myId = feState.myPlayerId;
  const isMyTurn = view.turn.currentPlayer === myId;

  const playCard = (cardId: string) => {
    send({ type: 'action', action: { type: 'playCard', player: myId, cardId } });
  };
  const endTurn = () => {
    send({ type: 'action', action: { type: 'endTurn', player: myId } });
  };

  return (
    <div style={styles.page()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>三国杀 - 房间 {roomId}</h1>
        <button onClick={handleLeave} style={styles.btn(colors.text.dim, { padding: '8px 16px' })}>
          离开
        </button>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 12, fontSize: 14 }}>
        <span>阶段: {view.turn.phase} | 当前玩家: {view.turn.currentPlayer}</span>
        {isMyTurn && <span style={{ color: colors.accent.green, marginLeft: 10 }}>- 你的回合！</span>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        {playerPanels.map(({ name, data }) => {
          const isSelfPanel = name === myId;
          const isCurrent = name === view.turn.currentPlayer;
          const role = isSelfPanel && data.kind === 'self'
            ? (typeof data.data.vars['role'] === 'string' ? data.data.vars['role'] : undefined)
            : undefined;
          return (
            <PlayerPanel
              key={name}
              playerName={name}
              data={data}
              cardMap={view.cardMap}
              isCurrentPlayer={isCurrent}
              isSelf={isSelfPanel}
              role={role}
            />
          );
        })}
      </div>

      <div style={{ marginBottom: 16 }}>
        <h3>我的手牌（{view.self.hand.length} 张）</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {view.self.hand.map((card: CardInfo) => (
            <button
              key={card.id}
              onClick={() => isMyTurn && playCard(card.id)}
              disabled={!isMyTurn}
              style={{
                backgroundColor: colors.bg.panel,
                padding: '8px 12px',
                borderRadius: 4,
                fontSize: 13,
                cursor: isMyTurn ? 'pointer' : 'not-allowed',
                opacity: isMyTurn ? 1 : 0.5,
                color: colors.text.input,
                border: 'none',
              }}
            >
              {card.name} {card.suit}{card.rank}
            </button>
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

      <div style={{ marginBottom: 16, textAlign: 'center' }}>
        <button
          onClick={endTurn}
          disabled={!isMyTurn}
          style={styles.btn(isMyTurn ? colors.accent.blue : colors.disabled, { padding: '10px 24px' })}
        >
          结束回合
        </button>
      </div>

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
