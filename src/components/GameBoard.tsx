import { useGame } from '../hooks/useGame';
import { PlayerPanel } from './PlayerPanel';
import { HandCards } from './HandCards';
import { ActionPanel } from './ActionPanel';
import { LogPanel } from './LogPanel';
import { Timer } from './Timer';

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
    timerSeconds,
    timerPaused,
    toggleTimer,
    switchPerspective,
    goToCurrentPlayer,
    handlePlayCard,
    handleEndTurn,
    handleSaveLog,
  } = useGame();

  const needsTarget = selectedCard !== null && validActions.validTargets.has(selectedCard);
  const validTargets = selectedCard !== null ? (validActions.validTargets.get(selectedCard) ?? []) : [];

  // 固定座次：按 game.players 顺序分配位置
  const players = game.players;
  const bottomPlayer = players[0]; // 始终是第一个玩家
  const topLeftPlayer = players[1];
  const topRightPlayer = players[2];
  const leftPlayer = players[3];
  const rightPlayer = players[4];

  const renderPlayerPanel = (player: typeof players[0]) => (
    <div
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
  );

  return (
    <div style={{ padding: 16, backgroundColor: '#1a1a2e', minHeight: '100vh', color: '#eee', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>三国杀</h1>
          <button
            onClick={switchPerspective}
            style={{ padding: '4px 12px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >
            切换视角 ({myName})
          </button>
          {myName !== game.currentPlayer && (
            <button
              onClick={goToCurrentPlayer}
              style={{ padding: '4px 12px', backgroundColor: '#2ecc71', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
            >
              查看当前玩家 ({game.currentPlayer})
            </button>
          )}
        </div>
        <Timer seconds={timerSeconds} paused={timerPaused} onToggle={toggleTimer} />
      </div>

      {needsTarget && (
        <div style={{ textAlign: 'center', marginBottom: 12, color: '#f39c12', fontSize: 14 }}>
          请选择目标玩家（点击玩家面板）
        </div>
      )}

      {/* 上方: 2个玩家 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 12 }}>
        {topLeftPlayer && renderPlayerPanel(topLeftPlayer)}
        {topRightPlayer && renderPlayerPanel(topRightPlayer)}
      </div>

      {/* 中间: 左 + 信息 + 右 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1, marginBottom: 12 }}>
        <div style={{ width: 160 }}>
          {leftPlayer && renderPlayerPanel(leftPlayer)}
        </div>

        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ marginBottom: 8, fontSize: 14, color: '#95a5a6' }}>
            回合 {game.round} | 阶段: {game.phase} | 当前玩家: {game.currentPlayer}
          </div>
          <div style={{ marginBottom: 8 }}>
            {!isMyTurn && <span style={{ color: '#f39c12' }}>等待对手...</span>}
            {game.status === '已结束' && <span style={{ color: '#e74c3c', fontWeight: 'bold' }}>游戏结束</span>}
          </div>
          <div style={{ fontSize: 12, color: '#7f8c8d' }}>
            弃牌堆: {game.discardPile.length} 张 | 牌堆: {game.deck.length} 张
          </div>
        </div>

        <div style={{ width: 160 }}>
          {rightPlayer && renderPlayerPanel(rightPlayer)}
        </div>
      </div>

      {/* 下方: 自己的面板 */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        {renderPlayerPanel(bottomPlayer)}
      </div>

      {/* 手牌区 */}
      <div style={{ marginBottom: 12 }}>
        <HandCards
          hand={me.hand}
          selectedIndex={selectedCard}
          onSelectCard={selectCard}
          playableIndices={isMyTurn ? validActions.playableCardIndices : undefined}
        />
      </div>

      {/* 操作按钮 */}
      <div style={{ marginBottom: 12 }}>
        <ActionPanel
          canPlay={canPlay}
          canEndTurn={isMyTurn && game.phase === '出牌'}
          onPlayCard={handlePlayCard}
          onEndTurn={handleEndTurn}
        />
      </div>

      {/* 工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
        <button onClick={handleSaveLog} style={{ padding: '6px 16px', backgroundColor: '#9b59b6', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
          保存日志
        </button>
      </div>

      {/* 日志 */}
      <LogPanel operations={playerOps} maxHeight={150} />
    </div>
  );
}
