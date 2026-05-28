import { useGame } from '../hooks/useGame';
import { PlayerPanel } from './PlayerPanel';
import { HandCards } from './HandCards';
import { ActionPanel } from './ActionPanel';
import { LogPanel } from './LogPanel';

export function GameBoard() {
  const {
    game,
    me,
    myName,
    isMyTurn,
    selectedCard,
    selectCard,
    selectedTarget,
    setSelectedTarget,
    canPlay,
    validActions,
    playerOps,
    switchPerspective,
    handlePlayCard,
    handleEndTurn,
    handleSaveLog,
  } = useGame();

  const needsTarget = selectedCard !== null && validActions.validTargets.has(selectedCard);
  const validTargets = selectedCard !== null ? (validActions.validTargets.get(selectedCard) ?? []) : [];

  return (
    <div style={{ padding: 20, backgroundColor: '#1a1a2e', minHeight: '100vh', color: '#eee' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>三国杀</h1>
        <button
          onClick={switchPerspective}
          style={{ padding: '4px 12px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
        >
          切换到 {myName === '曹操' ? '刘备' : '曹操'}
        </button>
        <span style={{ color: '#95a5a6', fontSize: 13 }}>当前视角: {myName}</span>
      </div>

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
              if (needsTarget && player.name !== myName && player.alive && validTargets.includes(player.name)) {
                setSelectedTarget(player.name === selectedTarget ? null : player.name);
              }
            }}
            style={{
              cursor: needsTarget && player.name !== myName && player.alive && validTargets.includes(player.name) ? 'pointer' : 'default',
              outline: selectedTarget === player.name ? '3px solid #e74c3c' : 'none',
              borderRadius: 12,
              transition: 'outline 0.2s',
              opacity: needsTarget && !validTargets.includes(player.name) && player.name !== myName ? 0.5 : 1,
            }}
          >
            <PlayerPanel
              player={player}
              isCurrentPlayer={player.name === game.currentPlayer}
              isSelf={player.name === myName}
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
