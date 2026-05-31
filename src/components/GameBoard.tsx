import { useGame } from '../hooks/useGame';
import { PlayerPanel } from './PlayerPanel';
import { HandCards } from './HandCards';
import { ActionPanel } from './ActionPanel';
import { LogPanel } from './LogPanel';
import { Timer } from './Timer';
import type { PlayerState } from '../../engine/v2/types';
import type { Operation } from '../../shared/log';
import { colors, styles } from '../theme';

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
    respondAction,
    respondToKill,
    respond,
    respondToDying,
    selectTargetCard,
    selectHarvestCard,
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
  const isAoeResponse = pendingPrompt?.type === 'aoeResponse';
  const isTrickResponse = pendingPrompt?.type === 'trickResponse';
  const isDuelResponse = pendingPrompt?.type === 'duelResponse';
  const isSelectCard = pendingPrompt?.type === 'selectCard';
  const isHarvestSelection = pendingPrompt?.type === 'harvestSelection';
  const isDyingWindow = pendingPrompt?.type === 'dyingWindow';

  const renderPlayerPanel = (entry: { name: string; player: PlayerState }) => {
    const { name, player } = entry;
    return (
      <div
        key={name}
        onClick={() => {
          if (
            needsTarget &&
            name !== myName &&
            player.info.alive &&
            validTargetList.includes(name)
          ) {
            setSelectedTarget(name === selectedTarget ? null : name);
          }
        }}
        style={{
          cursor:
            needsTarget && name !== myName && player.info.alive && validTargetList.includes(name)
              ? 'pointer'
              : 'default',
          outline: selectedTarget === name ? `3px solid ${colors.accent.red}` : 'none',
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
          distance={
            selectedCardId !== null && name !== myName ? getDistance(myName, name) : undefined
          }
        />
      </div>
    );
  };

  const playerOps: Operation[] = [];

  return (
    <div style={{ ...styles.page(16), display: 'flex', flexDirection: 'column' }}>
      {/* 顶部栏 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>三国杀</h1>
          <button onClick={switchPerspective} style={styles.smallBtn(colors.accent.blue)}>
            切换视角 ({myName})
          </button>
          {myName !== state.currentPlayer && !isKillResponse && !isDyingWindow && (
            <button onClick={goToCurrentPlayer} style={styles.smallBtn(colors.accent.green)}>
              查看当前玩家 ({state.currentPlayer})
            </button>
          )}
        </div>
        <Timer seconds={timerSeconds} paused={timerPaused} onToggle={toggleTimer} />
      </div>

      {/* 提示信息 */}
      {needsTarget && (
        <div
          style={{
            textAlign: 'center',
            marginBottom: 12,
            color: colors.accent.amber,
            fontSize: 14,
          }}
        >
          请选择目标玩家（点击玩家面板）
        </div>
      )}

      {/* 待响应提示 - 杀响应 */}
      {isKillResponse && pendingPrompt && (
        <div
          style={{
            textAlign: 'center',
            marginBottom: 16,
            padding: 12,
            backgroundColor: colors.accent.darkRed,
            borderRadius: 8,
            fontSize: 16,
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{pendingPrompt.text}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <button
              onClick={() => respondToKill(true)}
              disabled={!hasDodge}
              style={styles.btn(hasDodge ? colors.accent.green : colors.disabled, {
                cursor: hasDodge ? 'pointer' : 'not-allowed',
              })}
            >
              出闪 {hasDodge ? '' : '(无闪)'}
            </button>
            <button onClick={() => respondToKill(false)} style={styles.btn(colors.accent.red)}>
              不出，受伤害
            </button>
          </div>
        </div>
      )}

      {/* 待响应提示 - AOE（南蛮入侵/万箭齐发） */}
      {isAoeResponse && pendingPrompt && (
        <div
          style={{
            textAlign: 'center',
            marginBottom: 16,
            padding: 12,
            backgroundColor: colors.accent.orange,
            borderRadius: 8,
            fontSize: 16,
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{pendingPrompt.text}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            {(respondAction?.cards ?? []).length > 0 ? (
              respondAction!.cards.map((cardId) => {
                const card = state.cardMap[cardId];
                const required = pendingPrompt.requiredCard || '杀';
                return (
                  <button
                    key={cardId}
                    onClick={() => respond(cardId)}
                    style={styles.btn(colors.accent.green)}
                  >
                    出{required} ({card?.suit}
                    {card?.rank})
                  </button>
                );
              })
            ) : (
              <span style={{ color: colors.text.dim, fontSize: 14 }}>
                （无{pendingPrompt.requiredCard || '杀'}）
              </span>
            )}
            <button onClick={() => respond()} style={styles.btn(colors.accent.red)}>
              不出，受伤害
            </button>
          </div>
        </div>
      )}

      {/* 濒死救援提示 */}
      {isDyingWindow &&
        pendingPrompt &&
        state.pending?.type === 'dyingWindow' &&
        (() => {
          const currentSaver = state.pending.savers[state.pending.currentSaverIndex];
          const isSaver = currentSaver === myName;
          const saverPlayer = state.players[currentSaver];
          const hasPeach = saverPlayer.hand.some((id) => state.cardMap[id]?.name === '桃');
          return (
            <div
              style={{
                textAlign: 'center',
                marginBottom: 16,
                padding: 12,
                backgroundColor: colors.accent.darkRed,
                borderRadius: 8,
                fontSize: 16,
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
                {pendingPrompt.text}（当前救助者: {currentSaver}）
              </div>
              {isSaver ? (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  <button
                    onClick={() => respondToDying(currentSaver)}
                    disabled={!hasPeach}
                    style={styles.btn(hasPeach ? colors.accent.green : colors.disabled, {
                      padding: '8px 16px',
                      cursor: hasPeach ? 'pointer' : 'not-allowed',
                    })}
                  >
                    使用桃 {hasPeach ? '' : '(无桃)'}
                  </button>
                  <button
                    onClick={() => respondToDying(null)}
                    style={styles.btn(colors.accent.red, { padding: '8px 16px' })}
                  >
                    不出
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 14, color: colors.text.dim }}>
                  等待 {currentSaver} 决定是否救援...
                </div>
              )}
            </div>
          );
        })()}

      {/* 待响应提示 - 锦囊（无懈可击） */}
      {isTrickResponse && pendingPrompt && (
        <div
          style={{
            textAlign: 'center',
            marginBottom: 16,
            padding: 12,
            backgroundColor: colors.accent.purple,
            borderRadius: 8,
            fontSize: 16,
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
            对方对你使用了锦囊，是否出无懈可击？
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            {(respondAction?.cards ?? []).length > 0 ? (
              respondAction!.cards.map((cardId) => {
                const card = state.cardMap[cardId];
                return (
                  <button
                    key={cardId}
                    onClick={() => respond(cardId)}
                    style={styles.btn(colors.accent.green)}
                  >
                    出无懈可击 ({card?.suit}
                    {card?.rank})
                  </button>
                );
              })
            ) : (
              <span style={{ color: colors.text.dim, fontSize: 14 }}>（无无懈可击）</span>
            )}
            <button onClick={() => respond()} style={styles.btn(colors.accent.red)}>
              不出
            </button>
          </div>
        </div>
      )}

      {/* 待响应提示 - 决斗 */}
      {isDuelResponse && pendingPrompt && (
        <div
          style={{
            textAlign: 'center',
            marginBottom: 16,
            padding: 12,
            backgroundColor: colors.accent.orange,
            borderRadius: 8,
            fontSize: 16,
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{pendingPrompt.text}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            {(respondAction?.cards ?? []).length > 0 ? (
              respondAction!.cards.map((cardId) => {
                const card = state.cardMap[cardId];
                return (
                  <button
                    key={cardId}
                    onClick={() => respond(cardId)}
                    style={styles.btn(colors.accent.green)}
                  >
                    出杀 ({card?.suit}
                    {card?.rank})
                  </button>
                );
              })
            ) : (
              <span style={{ color: colors.text.dim, fontSize: 14 }}>（无杀）</span>
            )}
            <button onClick={() => respond()} style={styles.btn(colors.accent.red)}>
              不出，受伤害
            </button>
          </div>
        </div>
      )}

      {/* 待响应提示 - 选牌（顺手牵羊/过河拆桥） */}
      {isSelectCard && pendingPrompt && (
        <div
          style={{
            textAlign: 'center',
            marginBottom: 16,
            padding: 12,
            backgroundColor: colors.accent.purple,
            borderRadius: 8,
            fontSize: 16,
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{pendingPrompt.text}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            {(pendingPrompt.targetCardIds ?? []).map((cardId, idx) => {
              const showFaceDown =
                pendingPrompt.selectMode === 'steal' || pendingPrompt.selectMode === 'discard';
              return (
                <button
                  key={cardId}
                  onClick={() => selectTargetCard(cardId)}
                  style={{
                    ...styles.btn(showFaceDown ? colors.accent.amber : colors.accent.blue),
                    minWidth: showFaceDown ? 60 : 'auto',
                    fontSize: showFaceDown ? 13 : 14,
                  }}
                >
                  {showFaceDown
                    ? `第 ${idx + 1} 张`
                    : `${state.cardMap[cardId]?.name} (${state.cardMap[cardId]?.suit}${state.cardMap[cardId]?.rank})`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 五谷丰登选牌 */}
      {isHarvestSelection &&
        pendingPrompt &&
        state.pending?.type === 'harvestSelection' &&
        (() => {
          const harvest = state.pending as {
            type: 'harvestSelection';
            revealedCards: string[];
            pickOrder: string[];
            currentPickerIndex: number;
          };
          const currentPicker = harvest.pickOrder[harvest.currentPickerIndex];
          const isCurrentPicker = currentPicker === myName;
          return (
            <div
              style={{
                textAlign: 'center',
                marginBottom: 16,
                padding: 12,
                backgroundColor: colors.accent.green,
                borderRadius: 8,
                fontSize: 16,
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
                五谷丰登：由 {currentPicker} 选牌
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                {harvest.revealedCards.map((cardId) => {
                  const card = state.cardMap[cardId];
                  return (
                    <button
                      key={cardId}
                      onClick={() => (isCurrentPicker ? selectHarvestCard(cardId) : undefined)}
                      disabled={!isCurrentPicker}
                      style={{
                        ...styles.btn(isCurrentPicker ? colors.accent.blue : colors.disabled),
                        cursor: isCurrentPicker ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {card ? `${card.name} ${card.suit}${card.rank}` : '?'}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

      {/* 弃牌提示 */}
      {needsDiscard && (
        <div
          style={{
            textAlign: 'center',
            marginBottom: 16,
            padding: 12,
            backgroundColor: colors.accent.purple,
            borderRadius: 8,
            fontSize: 14,
          }}
        >
          <div style={{ marginBottom: 8 }}>
            手牌超过体力上限，请弃 {discardCount} 张牌（已选 {selectedForDiscard.size}/
            {discardCount}）
          </div>
          <button
            onClick={handleDiscard}
            disabled={selectedForDiscard.size !== discardCount}
            style={styles.btn(
              selectedForDiscard.size === discardCount ? colors.accent.green : colors.disabled,
              {
                cursor: selectedForDiscard.size === discardCount ? 'pointer' : 'not-allowed',
              },
            )}
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flex: 1,
          marginBottom: 12,
        }}
      >
        <div style={{ width: 160 }}>{leftBottomPlayer && renderPlayerPanel(leftBottomPlayer)}</div>

        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ marginBottom: 8, fontSize: 14, color: colors.text.muted }}>
            回合 {state.meta.round} | 阶段: {state.phase} | 当前玩家: {state.currentPlayer}
          </div>
          <div style={{ marginBottom: 8 }}>
            {!isMyTurn && !isKillResponse && !isAoeResponse && !isDyingWindow && (
              <span style={{ color: colors.accent.amber }}>等待对手...</span>
            )}
            {state.meta.status === '已结束' && (
              <span style={{ color: colors.accent.red, fontWeight: 'bold' }}>游戏结束</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: colors.text.dim }}>
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
              ? me.hand.map((id, idx) => (playableCardIds.has(id) ? idx : -1)).filter((i) => i >= 0)
              : undefined
          }
          discardSelectedIndices={
            needsDiscard
              ? new Set(
                  me.hand
                    .map((id, idx) => (selectedForDiscard.has(id) ? idx : -1))
                    .filter((i) => i >= 0),
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
          canEndTurn={
            isMyTurn &&
            (state.phase === '出牌' || state.phase === '弃牌') &&
            !isKillResponse &&
            !isDyingWindow
          }
          onPlayCard={handlePlayCard}
          onEndTurn={handleEndTurn}
        />
      </div>

      {/* 技能发动 */}
      {availableSkills.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
          {availableSkills.map((skill) => (
            <button
              key={skill.skillId}
              onClick={() => handleActivateSkill(skill.skillId)}
              style={styles.btn(colors.accent.orange, { padding: '6px 16px', fontSize: 13 })}
            >
              发动 {skill.name}
            </button>
          ))}
        </div>
      )}

      {/* 工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
        <button onClick={handleSaveLog} style={styles.smallBtn(colors.accent.purpleLight)}>
          保存日志
        </button>
      </div>

      {/* 日志 */}
      <LogPanel operations={playerOps} maxHeight={150} />

      {/* 调试面板 */}
      <details
        style={{ marginTop: 16, backgroundColor: colors.bg.nav, borderRadius: 8, padding: 12 }}
      >
        <summary
          style={{
            cursor: 'pointer',
            color: colors.accent.amber,
            fontSize: 14,
            fontWeight: 'bold',
          }}
        >
          调试信息（点击展开）
        </summary>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: colors.text.muted, marginBottom: 8 }}>
            牌堆: {state.zones.deck.length} 张 | 弃牌堆: {state.zones.discardPile.length} 张
          </div>
          {state.playerOrder.map((name) => {
            const player = state.players[name];
            return (
              <div
                key={name}
                style={{
                  marginBottom: 8,
                  padding: 8,
                  backgroundColor: colors.bg.page,
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: name === myName ? colors.accent.blue : colors.text.secondary,
                    fontWeight: 'bold',
                    marginBottom: 4,
                  }}
                >
                  {name} ({player.info.characterId}) - {player.health}/{player.maxHealth} HP
                  {!player.info.alive && <span style={{ color: colors.accent.red }}> [阵亡]</span>}
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
                          backgroundColor: colors.bg.panel,
                          borderRadius: 4,
                          color: colors.text.input,
                        }}
                      >
                        {card.name}
                        {card.suit}
                        {card.rank}
                      </span>
                    );
                  })}
                  {player.hand.length === 0 && (
                    <span style={{ fontSize: 11, color: colors.text.dim }}>无手牌</span>
                  )}
                </div>
                {Object.values(player.equipment).some(Boolean) && (
                  <div style={{ fontSize: 11, color: colors.accent.amber, marginTop: 4 }}>
                    装备: {player.equipment.weapon && state.cardMap[player.equipment.weapon]?.name}{' '}
                    {player.equipment.armor && state.cardMap[player.equipment.armor]?.name}{' '}
                    {player.equipment.horsePlus && state.cardMap[player.equipment.horsePlus]?.name}{' '}
                    {player.equipment.horseMinus &&
                      state.cardMap[player.equipment.horseMinus]?.name}
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
