import { useState, useEffect, useMemo } from 'react';
import { PlayerPanel, type PlayerPanelData } from './PlayerPanel';
import { HandCards } from './HandCards';
import { ActionPanel } from './ActionPanel';
import { LogPanel } from './LogPanel';
import { allCharacters } from '../../shared/characters';
import type { PlayerState, ValidAction, PromptOption, Json, PendingAction } from '../../engine/types';
import type { Card } from '../../shared/types';
import type { Operation } from '../../shared/log';
import { toCardInfoMap } from '../../engine/view/buildView';
import { colors, styles } from '../theme';

const characterMap = Object.fromEntries(allCharacters.map(c => [c.name, c]));

interface PendingPrompt {
  type: string;
  text: string;
  responder?: string;
  responders?: string[];
  attacker?: string;
  validCards?: string[];
  dyingPlayer?: string;
  savers?: string[];
  currentSaver?: string;
  requiredCard?: string;
  targetPlayer?: string;
  targetCardIds?: string[];
  selectMode?: 'discard' | 'steal';
  options?: PromptOption[];
}

/** 单个玩家在棋盘上展示所需的所有数据。 */
export interface PlayerEntry {
  name: string;
  panelData: PlayerPanelData;
  characterId: string;
  role: string;
  alive: boolean;
}

export interface GameBoardData {
  // 来自 GameState（保留以便 HandCards 等组件用，但 PlayerPanel 不再直接用）
  state: import('../../engine/types').GameState;
  cardMap: Record<string, Card>;
  me: PlayerState;
  myName: string;
  playerOrder: string[];
  isMyTurn: boolean;
  selectedCardId: string | null;
  selectedCardIndex: number | null;
  selectCard: (cardId: string | null) => void;
  selectedTarget: string | null;
  setSelectedTarget: (target: string | null) => void;
  canPlay: boolean;
  validActions: ValidAction[];
  playableCards: import('../../engine/types').PlayableCard[];
  playableCardIds: Set<string>;
  needsTarget: boolean;
  validTargetList: string[];
  handlePlayCard: () => void;
  handleEndTurn: () => void;
  needsDiscard: boolean;
  discardCount: number;
  discardCards: string[];
  selectedForDiscard: Set<string>;
  toggleDiscardSelection: (cardId: string) => void;
  handleDiscard: () => void;
  pendingPrompt: PendingPrompt | null;
  hasDodge: boolean;
  respondAction: Extract<ValidAction, { type: 'respond' }> | undefined;
  respondToKill: (playDodge: boolean) => void;
  respond: (cardId?: string) => void;
  respondToDying: (saverName: string | null) => void;
  selectTargetCard: (cardId: string) => void;
  selectHarvestCard: (cardId: string) => void;
  availableSkills: import('../../engine/types').AvailableSkill[];
  handleActivateSkill: (skillId: string, target?: string) => void;
  selectedSkillCards: Set<string>;
  toggleSkillCardSelection: (cardId: string) => void;
  handleSkillChoice: (choice: Json) => void;
  myHand: Card[];
  /** 玩家面板条目（按座位顺序），使用 PlayerView 派生数据 */
  orderedPlayers: PlayerEntry[];
  switchPerspective: () => void;
  setPerspective: (playerName: string) => void;
  goToCurrentPlayer: () => void;
  handleSaveLog: () => void;
  toggleAutoSkipWuxie: () => void;
  getDistance: (from: string, to: string) => number;
  pending: PendingAction | null;
}

export function GameBoard({ data }: { data: GameBoardData }) {
  const {
    state,
    me,
    myName,
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
    switchPerspective,
    goToCurrentPlayer,
    availableSkills,
    handleActivateSkill,
    selectedSkillCards,
    toggleSkillCardSelection,
    handleSkillChoice,
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
    toggleAutoSkipWuxie,
    setPerspective,
  } = data;

  const ordered = orderedPlayers;

  const bottomPlayer = ordered[0];
  const rightBottomPlayer = ordered[1];
  const rightTopPlayer = ordered[2];
  const leftTopPlayer = ordered[3];
  const leftBottomPlayer = ordered[4];

  const getSeatNumber = (playerName: string): number => {
    return state.playerOrder.indexOf(playerName) + 1;
  };

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  const deadline = state.pending?.deadline ?? null;
  const remainingSeconds = deadline !== null ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

  const waitingPlayers = (() => {
    const s = new Set<string>();
    const p = state.pending;
    if (!p) return s;
    switch (p.type) {
      case 'playPhase':
        s.add(p.player);
        break;
      case 'responseWindow':
        if (p.window.type === 'trickResponse' && p.window.responders) {
          const passed = p.window.passedResponders ?? [];
          p.window.responders.filter((r: string) => !passed.includes(r)).forEach((r: string) => s.add(r));
        } else {
          s.add(p.window.defender);
        }
        break;
      case 'discardPhase':
        s.add(p.player);
        break;
      case 'dyingWindow':
        s.add(p.savers[p.currentSaverIndex]);
        break;
      case 'selectCard':
        s.add(p.player);
        break;
      case 'harvestSelection':
        s.add(p.pickOrder[p.currentPickerIndex]);
        break;
      case 'skillPrompt':
        s.add(p.player);
        break;
    }
    return s;
  })();

  const isKillResponse = pendingPrompt?.type === 'killResponse';
  const isAoeResponse = pendingPrompt?.type === 'aoeResponse';
  const isTrickResponse = pendingPrompt?.type === 'trickResponse';
  const isDuelResponse = pendingPrompt?.type === 'duelResponse';
  const isSelectCard = pendingPrompt?.type === 'selectCard';
  const isHarvestSelection = pendingPrompt?.type === 'harvestSelection';
  const isDyingWindow = pendingPrompt?.type === 'dyingWindow';
  const isSkillPrompt = pendingPrompt?.type === 'skillPrompt';

  const viewCardMap = useMemo(() => toCardInfoMap(state.cardMap), [state.cardMap]);

  const renderPlayerPanel = (entry: PlayerEntry) => {
    const { name, panelData, characterId, alive } = entry;
    return (
      <div
        key={name}
        onClick={() => {
          if (
            needsTarget &&
            name !== myName &&
            alive &&
            validTargetList.includes(name)
          ) {
            setSelectedTarget(name === selectedTarget ? null : name);
          }
        }}
        onDoubleClick={() => setPerspective(name)}
        style={{
          cursor:
            needsTarget && name !== myName && alive && validTargetList.includes(name)
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
          data={panelData}
          cardMap={viewCardMap}
          isCurrentPlayer={name === state.currentPlayer}
          isSelf={name === myName}
          role={panelData.kind === 'self' ? entry.role : undefined}
          seatNumber={getSeatNumber(name)}
          distance={
            selectedCardId !== null && name !== myName ? getDistance(myName, name) : undefined
          }
          timerSeconds={waitingPlayers.has(name) ? remainingSeconds ?? undefined : undefined}
          abilities={characterMap[characterId]?.abilities}
        />
      </div>
    );
  };

  const playerOps: Operation[] = [];

  return (
    <div style={{ ...styles.page(16), display: 'flex', flexDirection: 'column' }}>
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
          {!isKillResponse && !isDyingWindow && (
            <button onClick={goToCurrentPlayer} style={styles.smallBtn(colors.accent.green)}>
              查看活跃玩家
            </button>
          )}
        </div>
      </div>

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
                const required = pendingPrompt.requiredCard ?? '杀';
                return (
                  <button
                    key={cardId}
                    onClick={() => respond(cardId)}
                    style={styles.btn(colors.accent.green)}
                  >
                    出{required} ({card?.suit}
                    {card?.rank}
                    )
                  </button>
                );
              })
            ) : (
              <span style={{ color: colors.text.dim, fontSize: 14 }}>
                （无{pendingPrompt.requiredCard ?? '杀'}）
              </span>
            )}
            <button onClick={() => respond()} style={styles.btn(colors.accent.red)}>
              不出，受伤害
            </button>
          </div>
        </div>
      )}

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

      {isSkillPrompt && pendingPrompt && (() => {
        const selectCardsOption = pendingPrompt.options?.find(o => 'type' in o && o.type === 'selectCards');
        if (!selectCardsOption || !('type' in selectCardsOption)) return null;
        const min = selectCardsOption.min ?? 1;
        const max = selectCardsOption.max ?? 99;
        const isCurrentPlayer = state.pending?.type === 'skillPrompt' && state.pending.player === myName;
        return (
          <div
            style={{
              textAlign: 'center',
              marginBottom: 16,
              padding: 12,
              backgroundColor: colors.accent.blue,
              borderRadius: 8,
              fontSize: 16,
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{pendingPrompt.text}</div>
            {isCurrentPlayer ? (
              <div>
                <div style={{ fontSize: 13, color: colors.text.dim, marginBottom: 8 }}>
                  点击手牌选择（已选 {selectedSkillCards.size}，最少 {min} 张）
                </div>
                <button
                  onClick={() => {
                    if (selectedSkillCards.size >= min && selectedSkillCards.size <= max) {
                      handleSkillChoice({ cardIds: [...selectedSkillCards] });
                    }
                  }}
                  disabled={selectedSkillCards.size < min || selectedSkillCards.size > max}
                  style={styles.btn(
                    selectedSkillCards.size >= min && selectedSkillCards.size <= max
                      ? colors.accent.green
                      : colors.disabled,
                    {
                      cursor:
                        selectedSkillCards.size >= min && selectedSkillCards.size <= max
                          ? 'pointer'
                          : 'not-allowed',
                    },
                  )}
                >
                  确认（{selectedSkillCards.size} 张）
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: colors.text.dim }}>
                等待技能发动者选择...
              </div>
            )}
          </div>
        );
      })()}

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
                    {card?.rank}
                    )
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
                    {card?.rank}
                    )
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

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 12 }}>
        {leftTopPlayer && renderPlayerPanel(leftTopPlayer)}
        {rightTopPlayer && renderPlayerPanel(rightTopPlayer)}
      </div>

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

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        {bottomPlayer && renderPlayerPanel(bottomPlayer)}
      </div>

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
            isMyTurn && !isKillResponse && !isDyingWindow && !needsDiscard && !isSkillPrompt
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
              : isSkillPrompt && state.pending?.type === 'skillPrompt' && state.pending.player === myName
                ? new Set(
                    me.hand
                      .map((id, idx) => (selectedSkillCards.has(id) ? idx : -1))
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
              : isSkillPrompt && state.pending?.type === 'skillPrompt' && state.pending.player === myName
                ? (index) => {
                    const cardId = me.hand[index];
                    if (cardId) toggleSkillCardSelection(cardId);
                  }
                : undefined
          }
        />
      </div>

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

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
        <button onClick={handleSaveLog} style={styles.smallBtn(colors.accent.purpleLight)}>
          保存日志
        </button>
      </div>

      <LogPanel operations={playerOps} maxHeight={150} />

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
          <button
            onClick={toggleAutoSkipWuxie}
            style={{
              ...styles.btn(state.meta.autoSkipWuxie ? colors.accent.green : colors.accent.red),
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            自动跳过无懈可击: {state.meta.autoSkipWuxie ? '开' : '关'}
          </button>
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
