import { useGame } from '../hooks/useGame';
import { PlayerPanel } from './PlayerPanel';
import { HandCards } from './HandCards';
import { ActionPanel } from './ActionPanel';
import { LogPanel } from './LogPanel';

export function GameBoard() {
  const {
    game,
    me,
    isMyTurn,
    selectedCard,
    selectCard,
    selectedTarget,
    setSelectedTarget,
    canPlay,
    validActions,
    playerOps,
    handlePlayCard,
    handleEndTurn,
    handleSaveLog,
  } = useGame();

  // 判断选中的牌是否需要选择目标
  const needsTarget = selectedCard !== null && validActions.validTargets.has(selectedCard);
  const validTargets = selectedCard !== null ? (validActions.validTargets.get(selectedCard) ?? []) : [];

  return (
    <div style={{ padding: 20, backgroundColor: '#1a1a2e', minHeight: '100vh', color: '#eee' }}>
      <h1 style={{ textAlign: 'center', marginBottom: 20 }}>三国杀</h1>

      {needsTarget && (
        <div style={{ textAlign: 'center', marginBottom: 16, color: '#f39c12', fontSize: 14 }}>
          请选择目标玩家（点击玩家面板）
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 30 }}>
        {game.players.map(player => (
          <div
            key={player.name}
            onClick={() => {
              if (needsTarget && player.name !== '曹操' && player.alive && validTargets.includes(player.name)) {
                setSelectedTarget(player.name === selectedTarget ? null : player.name);
              }
            }}
            style={{
              cursor: needsTarget && player.name !== '曹操' && player.alive && validTargets.includes(player.name) ? 'pointer' : 'default',
              outline: selectedTarget === player.name ? '3px solid #e74c3c' : 'none',
              borderRadius: 12,
              transition: 'outline 0.2s',
              opacity: needsTarget && !validTargets.includes(player.name) && player.name !== '曹操' ? 0.5 : 1,
            }}
          >
            <PlayerPanel
              player={player}
              isCurrentPlayer={player.name === game.currentPlayer}
              isSelf={player.name === '曹操'}
            />
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <span>回合 {game.round} | 阶段: {game.phase} | 当前玩家: {game.currentPlayer}</span>
        {!isMyTurn && <span style={{ color: '#f39c12', marginLeft: 12 }}>等待对手...</span>}
      </div>

      <div style={{ marginBottom: 20 }}>
        <HandCards
          hand={me.hand}
          selectedIndex={selectedCard}
          onSelectCard={selectCard}
          playableIndices={isMyTurn ? validActions.playableCardIndices : undefined}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <ActionPanel
          canPlay={canPlay}
          canEndTurn={isMyTurn && game.phase === '出牌'}
          onPlayCard={handlePlayCard}
          onEndTurn={handleEndTurn}
        />
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <button onClick={handleSaveLog} style={{ padding: '8px 20px', backgroundColor: '#9b59b6', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          保存日志
        </button>
      </div>

      <LogPanel operations={playerOps} />
    </div>
  );
}
