import { useGame } from '../hooks/useGame';
import { PlayerPanel } from './PlayerPanel';
import { HandCards } from './HandCards';
import { ActionPanel } from './ActionPanel';
import { LogPanel } from './LogPanel';
import { Timer } from './Timer';
import type { PlayerState } from '../../engine/v2/types';
import type { Operation } from '../../shared/log';

export function GameBoard() {
  const {
    state,
    me,
    myName,
    playerOrder,
    isMyTurn,
    selectedCardId,
    selectedCardIndex,
    selectCard,
    selectedTarget,
    setSelectedTarget,
    canPlay,
    playableCardIds,
    needsTarget,
    validTargetList,
    handlePlayCard,
    handleEndTurn,
    timerSeconds,
    timerPaused,
    toggleTimer,
    switchPerspective,
    goToCurrentPlayer,
    availableSkills,
    handleActivateSkill,
    pendingPrompt,
    hasDodge,
    respondToKill,
    respondToDying,
    needsDiscard,
    discardCount,
    selectedForDiscard,
    toggleDiscardSelection,
    handleDiscard,
    handleSaveLog,
    myHand,
    orderedPlayers,
    getDistance,
  } = useGame();

  const ordered = orderedPlayers;

  const bottomPlayer = ordered[0];
  const rightBottomPlayer = ordered[1];
  const rightTopPlayer = ordered[2];
  const leftTopPlayer = ordered[3];
  const leftBottomPlayer = ordered[4];

  const getSeatNumber = (playerName: string): number => {
    return state.playerOrder.indexOf(playerName) + 1;
  };

  const isKillResponse = pendingPrompt?.type === 'killResponse';
  const isDyingWindow = pendingPrompt?.type === 'dyingWindow';

  const renderPlayerPanel = (entry: { name: string; player: PlayerState }) => {
    const { name, player } = entry;
    return (
      <div
        key={name}
        onClick={() => {
          if (needsTarget && name !== myName && player.info.alive && validTargetList.includes(name)) {
            setSelectedTarget(name === selectedTarget ? null : name);
          }
        }}
        style={{
          cursor: needsTarget && name !== myName && player.info.alive && validTargetList.includes(name) ? 'pointer' : 'default',
          outline: selectedTarget === name ? '3px solid #e74c3c' : 'none',
          borderRadius: 12,
          transition: 'outline 0.2s',
          opacity: needsTarget && !validTargetList.includes(name) && name !== myName ? 0.5 : 1,
        }}
      >
        <PlayerPanel
          playerName={name}
          player={player}
          cardMap={state.cardMap}
          isCurrentPlayer={name === state.currentPlayer}
          isSelf={name === myName}
          seatNumber={getSeatNumber(name)}
          distance={selectedCardId !== null && name !== myName ? getDistance(myName, name) : undefined}
        />
      </div>
    );
  };

  const playerOps: Operation[] = [];

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
          {myName !== state.currentPlayer && !isKillResponse && !isDyingWindow && (
            <button
              onClick={goToCurrentPlayer}
              style={{ padding: '4px 12px', backgroundColor: '#2ecc71', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
            >
              查看当前玩家 ({state.currentPlayer})
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

      {/* 待响应提示 - 杀响应 */}
      {isKillResponse && pendingPrompt && (
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
            {pendingPrompt.text}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <button
              onClick={() => respondToKill(true)}
              disabled={!hasDodge}
              style={{
                padding: '8px 24px',
                backgroundColor: hasDodge ? '#2ecc71' : '#555',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: hasDodge ? 'pointer' : 'not-allowed',
                fontSize: 14,
                fontWeight: 'bold',
              }}
            >
              出闪 {hasDodge ? '' : '(无闪)'}
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
      {isDyingWindow && pendingPrompt && state.pending?.type === 'dyingWindow' && (
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
            {pendingPrompt.text}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            {state.pending.savers.map(saver => {
              const saverPlayer = state.players[saver];
              const hasPeach = saverPlayer.hand.some(id => state.cardMap[id]?.name === '桃');
              return (
                <button
                  key={saver}
                  onClick={() => respondToDying(saver)}
                  disabled={!hasPeach}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: hasPeach ? '#2ecc71' : '#555',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: hasPeach ? 'pointer' : 'not-allowed',
                  }}
                >
                  {saver} 使用桃
                </button>
              );
            })}
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
            回合 {state.meta.round} | 阶段: {state.phase} | 当前玩家: {state.currentPlayer}
          </div>
          <div style={{ marginBottom: 8 }}>
            {!isMyTurn && !isKillResponse && !isDyingWindow && <span style={{ color: '#f39c12' }}>等待对手...</span>}
            {state.meta.status === '已结束' && <span style={{ color: '#e74c3c', fontWeight: 'bold' }}>游戏结束</span>}
          </div>
          <div style={{ fontSize: 12, color: '#7f8c8d' }}>
            弃牌堆: {state.zones.discardPile.length} 张 | 牌堆: {state.zones.deck.length} 张
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
          hand={myHand}
          selectedIndex={selectedCardIndex}
          onSelectCard={(index) => {
            if (index === -1) {
              selectCard(null);
            } else {
              const cardId = me.hand[index];
              if (cardId) selectCard(cardId);
            }
          }}
          playableIndices={
            isMyTurn && !isKillResponse && !isDyingWindow && !needsDiscard
              ? me.hand
                  .map((id, idx) => playableCardIds.has(id) ? idx : -1)
                  .filter(i => i >= 0)
              : undefined
          }
          discardSelectedIndices={
            needsDiscard
              ? new Set(
                  me.hand
                    .map((id, idx) => selectedForDiscard.has(id) ? idx : -1)
                    .filter(i => i >= 0),
                )
              : undefined
          }
          onToggleDiscard={
            needsDiscard
              ? (index) => {
                  const cardId = me.hand[index];
                  if (cardId) toggleDiscardSelection(cardId);
                }
              : undefined
          }
        />
      </div>

      {/* 操作按钮 */}
      <div style={{ marginBottom: 12 }}>
        <ActionPanel
          canPlay={canPlay}
          canEndTurn={isMyTurn && (state.phase === '出牌' || state.phase === '弃牌') && !isKillResponse && !isDyingWindow}
          onPlayCard={handlePlayCard}
          onEndTurn={handleEndTurn}
        />
      </div>

      {/* 技能发动 */}
      {availableSkills.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
          {availableSkills.map(skill => (
            <button
              key={skill.skillId}
              onClick={() => handleActivateSkill(skill.skillId)}
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
              发动 {skill.name}
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

      {/* 调试面板 */}
      <details style={{ marginTop: 16, backgroundColor: '#16213e', borderRadius: 8, padding: 12 }}>
        <summary style={{ cursor: 'pointer', color: '#f39c12', fontSize: 14, fontWeight: 'bold' }}>
          调试信息（点击展开）
        </summary>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#95a5a6', marginBottom: 8 }}>
            牌堆: {state.zones.deck.length} 张 | 弃牌堆: {state.zones.discardPile.length} 张
          </div>
          {state.playerOrder.map(name => {
            const player = state.players[name];
            const character = state.cardMap[player.info.characterId];
            return (
              <div key={name} style={{ marginBottom: 8, padding: 8, backgroundColor: '#1a1a2e', borderRadius: 4 }}>
                <div style={{ fontSize: 13, color: name === myName ? '#3498db' : '#bdc3c7', fontWeight: 'bold', marginBottom: 4 }}>
                  {name} ({player.info.characterId}) - {player.health}/{player.maxHealth} HP
                  {!player.info.alive && <span style={{ color: '#e74c3c' }}> [阵亡]</span>}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {player.hand.map((cardId) => {
                    const card = state.cardMap[cardId];
                    if (!card) return null;
                    return (
                      <span
                        key={cardId}
                        style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          backgroundColor: '#2c3e50',
                          borderRadius: 4,
                          color: '#ecf0f1',
                        }}
                      >
                        {card.name}{card.suit}{card.rank}
                      </span>
                    );
                  })}
                  {player.hand.length === 0 && <span style={{ fontSize: 11, color: '#7f8c8d' }}>无手牌</span>}
                </div>
                {Object.values(player.equipment).some(Boolean) && (
                  <div style={{ fontSize: 11, color: '#f39c12', marginTop: 4 }}>
                    装备: {player.equipment.weapon && state.cardMap[player.equipment.weapon]?.name} {player.equipment.armor && state.cardMap[player.equipment.armor]?.name} {player.equipment.horsePlus && state.cardMap[player.equipment.horsePlus]?.name} {player.equipment.horseMinus && state.cardMap[player.equipment.horseMinus]?.name}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
