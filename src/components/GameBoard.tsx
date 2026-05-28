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
    setSelectedCard,
    playerOps,
    handlePlayCard,
    handleEndTurn,
    handleSaveLog,
  } = useGame();

  return (
    <div style={{ padding: 20, backgroundColor: '#1a1a2e', minHeight: '100vh', color: '#eee' }}>
      <h1 style={{ textAlign: 'center', marginBottom: 20 }}>三国杀</h1>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 30 }}>
        {game.players.map(player => (
          <PlayerPanel
            key={player.name}
            player={player}
            isCurrentPlayer={player.name === game.currentPlayer}
            isSelf={player.name === '曹操'}
          />
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
          onSelectCard={(index) => setSelectedCard(index === -1 ? null : index)}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <ActionPanel
          canPlay={selectedCard !== null && isMyTurn && game.phase === '出牌'}
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
