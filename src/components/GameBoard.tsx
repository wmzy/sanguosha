import { useGame, getValidTargets } from '../hooks/useGame';
import { getDistance } from '../../engine/core/distance';
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
    playerOrder,
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
    availableSkills,
    handleActivateSkill,
    pendingResponse,
    targetHasDodge,
    respondToKill,
    pendingDying,
    respondToDying,
    needsDiscard,
    discardCount,
    selectedForDiscard,
    toggleDiscardSelection,
    handleDiscard,
    handlePlayCard,
    handleEndTurn,
    handleSaveLog,
  } = useGame();

  const needsTarget = selectedCard !== null && validActions.validTargets.has(selectedCard);
  const validTargets = selectedCard !== null
    ? getValidTargets(game, myName, me.hand[selectedCard])
    : [];

  // 按 playerOrder 排列玩家（逆时针顺序）
  const orderedPlayers = playerOrder
    .map(name => game.players.find(p => p.name === name))
    .filter(Boolean) as typeof game.players;

  // 座位布局（逆时针）: [0]底部, [1]右下, [2]右上, [3]左上, [4]左下
  const bottomPlayer = orderedPlayers[0];
  const rightBottomPlayer = orderedPlayers[1];
  const rightTopPlayer = orderedPlayers[2];
  const leftTopPlayer = orderedPlayers[3];
  const leftBottomPlayer = orderedPlayers[4];

  // 获取玩家在原始数组中的座次号
  const getSeatNumber = (playerName: string): number => {
    return game.players.findIndex(p => p.name === playerName) + 1;
  };

  const renderPlayerPanel = (player: typeof game.players[0]) => (
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
        seatNumber={getSeatNumber(player.name)}
        distance={selectedCard !== null && player.name !== myName ? getDistance(game, myName, player.name) : undefined}
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
          {myName !== game.currentPlayer && !pendingResponse && !pendingDying && (
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

      {/* 提示信息 */}
      {needsTarget && (
        <div style={{ textAlign: 'center', marginBottom: 12, color: '#f39c12', fontSize: 14 }}>
          请选择目标玩家（点击玩家面板）
        </div>
      )}

      {/* 待响应提示 */}
      {pendingResponse && (
        <div style={{
          textAlign: 'center',
          marginBottom: 16,
          padding: 12,
          backgroundColor: '#c0392b',
          borderRadius: 8,
          fontSize: 16,
        }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
            {pendingResponse.attacker} 对你使用了杀！
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <button
              onClick={() => respondToKill(true)}
              disabled={!targetHasDodge}
              style={{
                padding: '8px 24px',
                backgroundColor: targetHasDodge ? '#2ecc71' : '#555',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: targetHasDodge ? 'pointer' : 'not-allowed',
                fontSize: 14,
                fontWeight: 'bold',
              }}
            >
              出闪 {targetHasDodge ? '' : '(无闪)'}
            </button>
            <button
              onClick={() => respondToKill(false)}
              style={{
                padding: '8px 24px',
                backgroundColor: '#e74c3c',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 'bold',
              }}
            >
              不出，受伤害
            </button>
          </div>
        </div>
      )}

      {/* 濒死救援提示 */}
      {pendingDying && (
        <div style={{
          textAlign: 'center',
          marginBottom: 16,
          padding: 12,
          backgroundColor: '#c0392b',
          borderRadius: 8,
          fontSize: 16,
        }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
            {pendingDying.player} 濒死！需要桃来救援
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            {pendingDying.savers.map(saver => (
              <button
                key={saver}
                onClick={() => respondToDying(saver)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#2ecc71',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                {saver} 使用桃
              </button>
            ))}
            <button
              onClick={() => respondToDying(null)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#e74c3c',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              无人救援
            </button>
          </div>
        </div>
      )}

      {/* 弃牌提示 */}
      {needsDiscard && (
        <div style={{
          textAlign: 'center',
          marginBottom: 16,
          padding: 12,
          backgroundColor: '#8e44ad',
          borderRadius: 8,
          fontSize: 14,
        }}
        >
          <div style={{ marginBottom: 8 }}>
            手牌超过体力上限，请弃 {discardCount} 张牌（已选 {selectedForDiscard.size}/{discardCount}）
          </div>
          <button
            onClick={handleDiscard}
            disabled={selectedForDiscard.size !== discardCount}
            style={{
              padding: '8px 24px',
              backgroundColor: selectedForDiscard.size === discardCount ? '#2ecc71' : '#555',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: selectedForDiscard.size === discardCount ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 'bold',
            }}
          >
            确认弃牌
          </button>
        </div>
      )}

      {/* 上方玩家（逆时针） */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 12 }}>
        {leftTopPlayer && renderPlayerPanel(leftTopPlayer)}
        {rightTopPlayer && renderPlayerPanel(rightTopPlayer)}
      </div>

      {/* 中间: 左 + 信息 + 右 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 1, marginBottom: 12 }}>
        <div style={{ width: 160 }}>
          {leftBottomPlayer && renderPlayerPanel(leftBottomPlayer)}
        </div>

        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ marginBottom: 8, fontSize: 14, color: '#95a5a6' }}>
            回合 {game.round} | 阶段: {game.phase} | 当前玩家: {game.currentPlayer}
          </div>
          <div style={{ marginBottom: 8 }}>
            {!isMyTurn && !pendingResponse && !pendingDying && <span style={{ color: '#f39c12' }}>等待对手...</span>}
            {game.status === '已结束' && <span style={{ color: '#e74c3c', fontWeight: 'bold' }}>游戏结束</span>}
          </div>
          <div style={{ fontSize: 12, color: '#7f8c8d' }}>
            弃牌堆: {game.discardPile.length} 张 | 牌堆: {game.deck.length} 张
          </div>
        </div>

        <div style={{ width: 160 }}>
          {rightBottomPlayer && renderPlayerPanel(rightBottomPlayer)}
        </div>
      </div>

      {/* 下方: 自己的面板 */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        {bottomPlayer && renderPlayerPanel(bottomPlayer)}
      </div>

      {/* 手牌区 */}
      <div style={{ marginBottom: 12 }}>
        <HandCards
          hand={me.hand}
          selectedIndex={selectedCard}
          onSelectCard={selectCard}
          playableIndices={isMyTurn && !pendingResponse && !pendingDying && !needsDiscard ? validActions.playableCardIndices : undefined}
          discardSelectedIndices={needsDiscard ? selectedForDiscard : undefined}
          onToggleDiscard={needsDiscard ? toggleDiscardSelection : undefined}
        />
      </div>

      {/* 操作按钮 */}
      <div style={{ marginBottom: 12 }}>
        <ActionPanel
          canPlay={canPlay}
          canEndTurn={isMyTurn && game.phase === '出牌' && !pendingResponse && !pendingDying}
          onPlayCard={handlePlayCard}
          onEndTurn={handleEndTurn}
        />
      </div>

      {/* 技能发动 */}
      {availableSkills.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
          {availableSkills.map((skill, index) => (
            <button
              key={skill.ability.name}
              onClick={() => handleActivateSkill(index)}
              style={{
                padding: '6px 16px',
                backgroundColor: '#e67e22',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              发动 {skill.ability.name}
            </button>
          ))}
        </div>
      )}

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
