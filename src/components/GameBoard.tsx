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
    handlePlayCard,
    handleEndTurn,
    handleSaveLog,
  } = useGame();

  const needsTarget = selectedCard !== null && validActions.validTargets.has(selectedCard);
  const validTargets = selectedCard !== null ? (validActions.validTargets.get(selectedCard) ?? []) : [];

  // 5人座位布局: 上2, 左1, 右1, 下1(自己)
  const otherPlayers = game.players.filter(p => p.name !== myName);
  const topPlayers = otherPlayers.slice(0, 2);
  const leftPlayer = otherPlayers[2];
  const rightPlayer = otherPlayers[3];

  const renderPlayerPanel = (player: typeof game.players[0], extraStyle?: React.CSSProperties) => (
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
        ...extraStyle,
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
        </div>
        <Timer seconds={timerSeconds} paused={timerPaused} onToggle={toggleTimer} />
      </div>

      {needsTarget && (
        <div style={{ textAlign: 'center', marginBottom: 12, color: '#f39c12', fontSize: 14 }}>
          请选择目标玩家（点击玩家面板）
        </div>
      )}

      {/* 上方玩家 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 12 }}>
        {topPlayers.map(p => renderPlayerPanel(p))}
      </div>

      {/* 中间区域: 左玩家 + 游戏信息 + 右玩家 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1, marginBottom: 12 }}>
        {/* 左 */}
        <div style={{ width: 160 }}>
          {leftPlayer && renderPlayerPanel(leftPlayer)}
        </div>

        {/* 中心信息 */}
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ marginBottom: 8, fontSize: 14, color: '#95a5a6' }}>
            回合 {game.round} | 阶段: {game.phase} | 当前玩家: {game.currentPlayer}
          </div>
          <div style={{ marginBottom: 8 }}>
            {!isMyTurn && <span style={{ color: '#f39c12' }}>等待对手...</span>}
            {game.status === '已结束' && <span style={{ color: '#e74c3c', fontWeight: 'bold' }}>游戏结束</span>}
          </div>
          {/* 弃牌堆 */}
          <div style={{ fontSize: 12, color: '#7f8c8d' }}>
            弃牌堆: {game.discardPile.length} 张 | 牌堆: {game.deck.length} 张
          </div>
        </div>

        {/* 右 */}
        <div style={{ width: 160 }}>
          {rightPlayer && renderPlayerPanel(rightPlayer)}
        </div>
      </div>

      {/* 下方: 自己 */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        {renderPlayerPanel(me)}
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

      {/* 底部工具栏 */}
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
