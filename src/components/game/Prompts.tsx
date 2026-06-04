import { memo } from 'react';
import { css, cx } from '@linaria/core';
import { colors, styles } from '../../theme';
import type {
  GameState,
  ValidAction,
  PromptOption,
  Json,
  PendingAction,
} from '../../../engine/types';

export interface PendingPromptData {
  type: string;
  text: string;
  wuxieChain?: { attacker: string; cardId: string }[];
  sourceName?: string;
  sourceUser?: string;
  trickTarget?: string;
  requiredCard?: string;
  targetCardIds?: string[];
  selectMode?: 'discard' | 'steal';
  options?: PromptOption[];
}

interface GamePromptsProps {
  state: GameState;
  pendingPrompt: PendingPromptData | null;
  pending: PendingAction | null;
  respondAction: Extract<ValidAction, { type: 'respond' }> | undefined;
  selectedSkillCards: Set<string>;
  needsDiscard: boolean;
  discardCount: number;
  selectedForDiscard: Set<string>;
  myName: string;
  hasDodge: boolean;
  respondToKill: (playDodge: boolean) => void;
  respond: (cardId?: string) => void;
  respondToDying: (saverName: string | null) => void;
  selectTargetCard: (cardId: string) => void;
  selectHarvestCard: (cardId: string) => void;
  handleSkillChoice: (choice: Json) => void;
  handleDiscard: () => void;
}

const promptBase = css`
  text-align: center;
  margin-bottom: 16px;
  padding: 12px;
  border-radius: 8px;
  font-size: 16px;
`;

const promptBgRed = css`
  background-color: ${colors.accent.darkRed};
`;

const promptBgOrange = css`
  background-color: ${colors.accent.orange};
`;

const promptBgPurple = css`
  background-color: ${colors.accent.purple};
`;

const promptBgBlue = css`
  background-color: ${colors.accent.blue};
`;

const promptBgGreen = css`
  background-color: ${colors.accent.green};
`;

const promptTitle = css`
  font-weight: bold;
  margin-bottom: 8px;
`;

const promptButtonsRow = css`
  display: flex;
  justify-content: center;
  gap: 12px;
`;

const promptButtonsRowWrap = css`
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
`;

const promptButtonsRowGap8 = css`
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const promptDim14 = css`
  color: ${colors.text.dim};
  font-size: 14px;
`;

const promptDim13 = css`
  font-size: 13px;
  color: ${colors.text.dim};
  margin-bottom: 8px;
`;

const wuxieRow = css`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  font-size: 14px;
`;

const wuxieInlineItem = css`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const wuxieArrow = css`
  color: ${colors.text.dim};
`;

const wuxieSourcePill = css`
  padding: 4px 10px;
  border-radius: 12px;
  background-color: ${colors.accent.purpleLight};
  color: ${colors.white};
  font-weight: bold;
`;

const wuxieResultPill = css`
  padding: 4px 10px;
  border-radius: 12px;
  color: ${colors.white};
  font-weight: bold;
`;

const wuxieResultGreen = css`
  background-color: ${colors.accent.green};
`;

const wuxieResultRed = css`
  background-color: ${colors.accent.red};
`;

const wuxieAskPill = css`
  padding: 4px 12px;
  border-radius: 12px;
  background-color: ${colors.accent.amber};
  color: ${colors.bg.page};
  font-weight: bold;
`;

const selectCardBtnNormal = css`
  font-size: 14px;
`;

const selectCardBtnFaceDown = css`
  min-width: 60px;
  font-size: 13px;
`;

function DiscardPrompt({
  discardCount,
  selectedForDiscard,
  onConfirm,
}: {
  discardCount: number;
  selectedForDiscard: Set<string>;
  onConfirm: () => void;
}) {
  return (
    <div
      className={promptBase}
      style={{
        backgroundColor: colors.accent.purple,
        fontSize: 14,
      }}
    >
      <div className={promptTitle}>
        手牌超过体力上限，请弃 {discardCount} 张牌（已选 {selectedForDiscard.size}/{discardCount}）
      </div>
      <button
        onClick={onConfirm}
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
  );
}

export const GamePrompts = memo(function GamePrompts({
  state,
  pendingPrompt,
  pending,
  respondAction,
  selectedSkillCards,
  needsDiscard,
  discardCount,
  selectedForDiscard,
  myName,
  hasDodge,
  respondToKill,
  respond,
  respondToDying,
  selectTargetCard,
  selectHarvestCard,
  handleSkillChoice,
  handleDiscard,
}: GamePromptsProps) {
  const respondCards = respondAction?.cards ?? [];
  const promptNode = (() => {
    if (!pendingPrompt) return null;

    if (pendingPrompt.type === 'killResponse') {
      return (
        <div className={cx(promptBase, promptBgRed)}>
          <div className={promptTitle}>{pendingPrompt.text}</div>
          <div className={promptButtonsRow}>
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
      );
    }

    if (pendingPrompt.type === 'aoeResponse') {
      const required = pendingPrompt.requiredCard ?? '杀';
      return (
        <div className={cx(promptBase, promptBgOrange)}>
          <div className={promptTitle}>{pendingPrompt.text}</div>
          <div className={promptButtonsRowWrap}>
            {respondCards.length > 0 ? (
              respondCards.map((cardId) => {
                const card = state.cardMap[cardId];
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
              <span className={promptDim14}>（无{required}）</span>
            )}
            <button onClick={() => respond()} style={styles.btn(colors.accent.red)}>
              不出，受伤害
            </button>
          </div>
        </div>
      );
    }

    if (pendingPrompt.type === 'trickResponse') {
      return (
        <div className={cx(promptBase, promptBgPurple)}>
          <div className={promptTitle}>{pendingPrompt.text}</div>
          {pendingPrompt.wuxieChain !== undefined && (
            <div className={wuxieRow}>
              {pendingPrompt.sourceName && (
                <span className={wuxieSourcePill}>
                  {pendingPrompt.sourceName}（{pendingPrompt.sourceUser} → {pendingPrompt.trickTarget}）
                </span>
              )}
              {pendingPrompt.wuxieChain.map((w, i) => {
                const makesEffective = (i + 1) % 2 === 0;
                const statusLabel = makesEffective ? '生效' : '失效';
                return (
                  <span key={`${w.cardId}-${i}`} className={wuxieInlineItem}>
                    <span className={wuxieArrow}>→</span>
                    <span
                      className={cx(
                        wuxieResultPill,
                        makesEffective ? wuxieResultGreen : wuxieResultRed,
                      )}
                    >
                      {w.attacker} 的无懈（{statusLabel}）
                    </span>
                  </span>
                );
              })}
              <span className={wuxieArrow}>→</span>
              <span className={wuxieAskPill}>你出无懈可击？</span>
            </div>
          )}
          <div className={promptButtonsRowWrap}>
            {respondCards.length > 0 ? (
              respondCards.map((cardId) => {
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
              <span className={promptDim14}>（无无懈可击）</span>
            )}
            <button onClick={() => respond()} style={styles.btn(colors.accent.red)}>
              不出
            </button>
          </div>
        </div>
      );
    }

    if (pendingPrompt.type === 'duelResponse') {
      return (
        <div className={cx(promptBase, promptBgOrange)}>
          <div className={promptTitle}>{pendingPrompt.text}</div>
          <div className={promptButtonsRowWrap}>
            {respondCards.length > 0 ? (
              respondCards.map((cardId) => {
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
              <span className={promptDim14}>（无杀）</span>
            )}
            <button onClick={() => respond()} style={styles.btn(colors.accent.red)}>
              不出，受伤害
            </button>
          </div>
        </div>
      );
    }

    if (pendingPrompt.type === 'dyingWindow' && pending?.type === 'dyingWindow') {
      const currentSaver = pending.savers[pending.currentSaverIndex];
      const isSaver = currentSaver === myName;
      const saverPlayer = state.players[currentSaver];
      const hasPeach = saverPlayer.hand.some((id) => state.cardMap[id]?.name === '桃');
      return (
        <div className={cx(promptBase, promptBgRed)}>
          <div className={promptTitle}>
            {pendingPrompt.text}（当前救助者: {currentSaver}）
          </div>
          {isSaver ? (
            <div className={promptButtonsRow}>
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
            <div className={promptDim14}>等待 {currentSaver} 决定是否救援...</div>
          )}
        </div>
      );
    }

    if (pendingPrompt.type === 'skillPrompt') {
      const selectCardsOption = pendingPrompt.options?.find(
        (o) => 'type' in o && o.type === 'selectCards',
      );
      if (selectCardsOption && 'type' in selectCardsOption) {
        const min = selectCardsOption.min ?? 1;
        const max = selectCardsOption.max ?? 99;
        const isCurrentPlayer = pending?.type === 'skillPrompt' && pending.player === myName;
        return (
          <div className={cx(promptBase, promptBgBlue)}>
            <div className={promptTitle}>{pendingPrompt.text}</div>
            {isCurrentPlayer ? (
              <div>
                <div className={promptDim13}>
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
              <div className={promptDim14}>等待技能发动者选择...</div>
            )}
          </div>
        );
      }
      return null;
    }

    if (pendingPrompt.type === 'selectCard') {
      return (
        <div className={cx(promptBase, promptBgPurple)}>
          <div className={promptTitle}>{pendingPrompt.text}</div>
          <div className={promptButtonsRowGap8}>
            {(pendingPrompt.targetCardIds ?? []).map((cardId, idx) => {
              const showFaceDown =
                pendingPrompt.selectMode === 'steal' || pendingPrompt.selectMode === 'discard';
              const card = state.cardMap[cardId];
              return (
                <button
                  key={cardId}
                  onClick={() => selectTargetCard(cardId)}
                  className={showFaceDown ? selectCardBtnFaceDown : selectCardBtnNormal}
                  style={styles.btn(showFaceDown ? colors.accent.amber : colors.accent.blue)}
                >
                  {showFaceDown
                    ? `第 ${idx + 1} 张`
                    : `${card?.name} (${card?.suit}${card?.rank})`}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (pendingPrompt.type === 'harvestSelection' && pending?.type === 'harvestSelection') {
      const currentPicker = pending.pickOrder[pending.currentPickerIndex];
      const isCurrentPicker = currentPicker === myName;
      return (
        <div className={cx(promptBase, promptBgGreen)}>
          <div className={promptTitle}>五谷丰登：由 {currentPicker} 选牌</div>
          <div className={promptButtonsRowGap8}>
            {pending.revealedCards.map((cardId) => {
              const card = state.cardMap[cardId];
              return (
                <button
                  key={cardId}
                  onClick={() => (isCurrentPicker ? selectHarvestCard(cardId) : undefined)}
                  disabled={!isCurrentPicker}
                  style={styles.btn(isCurrentPicker ? colors.accent.blue : colors.disabled, {
                    cursor: isCurrentPicker ? 'pointer' : 'not-allowed',
                  })}
                >
                  {card ? `${card.name} ${card.suit}${card.rank}` : '?'}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    return null;
  })();

  return (
    <>
      {promptNode}
      {needsDiscard && (
        <DiscardPrompt
          discardCount={discardCount}
          selectedForDiscard={selectedForDiscard}
          onConfirm={handleDiscard}
        />
      )}
    </>
  );
});
