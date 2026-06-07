import { memo } from 'react';
import { HandCards } from '../HandCards';
import type { Card } from '../../../shared/types';

interface HandCardsSectionProps {
  hand: Card[];
  me: { hand: string[] };
  selectedIndex: number | null;
  isMyTurn: boolean;
  isKillResponse: boolean;
  isDyingWindow: boolean;
  isSkillPrompt: boolean;
  needsDiscard: boolean;
  isCurrentPickerForSkill: boolean;
  playableCardIds: Set<string>;
  selectedForDiscard: Set<string>;
  selectedSkillCards: Set<string>;
  onSelectCard: (cardId: string | null) => void;
  onToggleDiscard: (cardId: string) => void;
  onToggleSkillCard: (cardId: string) => void;
}

export const HandCardsSection = memo(({
  hand,
  me,
  selectedIndex,
  isMyTurn,
  isKillResponse,
  isDyingWindow,
  isSkillPrompt,
  needsDiscard,
  isCurrentPickerForSkill,
  playableCardIds,
  selectedForDiscard,
  selectedSkillCards,
  onSelectCard,
  onToggleDiscard,
  onToggleSkillCard,
}: HandCardsSectionProps) => {
  const showPlayable =
    isMyTurn && !isKillResponse && !isDyingWindow && !needsDiscard && !isSkillPrompt;

  const playableIndices = showPlayable
    ? me.hand
        .map((id, idx) => (playableCardIds.has(id) ? idx : -1))
        .filter((i) => i >= 0)
    : undefined;

  const toIndexSet = (ids: Set<string>): Set<number> =>
    new Set(
      me.hand
        .map((id, idx) => (ids.has(id) ? idx : -1))
        .filter((i) => i >= 0),
    );

  const discardSelectedIndices = needsDiscard
    ? toIndexSet(selectedForDiscard)
    : isCurrentPickerForSkill
      ? toIndexSet(selectedSkillCards)
      : undefined;

  const onToggleDiscardHandler = needsDiscard
    ? (index: number) => {
        const cardId = me.hand[index];
        if (cardId) onToggleDiscard(cardId);
      }
    : isCurrentPickerForSkill
      ? (index: number) => {
          const cardId = me.hand[index];
          if (cardId) onToggleSkillCard(cardId);
        }
      : undefined;

  return (
    <HandCards
      hand={hand}
      selectedIndex={selectedIndex}
      onSelectCard={(index) => {
        if (index === -1) {
          onSelectCard(null);
        } else {
          const cardId = me.hand[index];
          if (cardId) onSelectCard(cardId);
        }
      }}
      playableIndices={playableIndices}
      discardSelectedIndices={discardSelectedIndices}
      onToggleDiscard={onToggleDiscardHandler}
    />
  );
});
