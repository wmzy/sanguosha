import { memo } from 'react';
import type { Card } from '../../shared/types';
import { colors, styles } from '../theme';

interface HandCardsProps {
  hand: Card[];
  selectedIndex: number | null;
  onSelectCard: (index: number) => void;
  playableIndices?: number[];
  discardSelectedIndices?: Set<number>;
  onToggleDiscard?: (index: number) => void;
}

function HandCardsInner({
  hand,
  selectedIndex,
  onSelectCard,
  playableIndices,
  discardSelectedIndices,
  onToggleDiscard,
}: HandCardsProps) {
  const playableSet = new Set(playableIndices ?? []);
  const isDiscardMode = discardSelectedIndices !== undefined;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
      {hand.map((card, index) => {
        const isSelected = isDiscardMode
          ? discardSelectedIndices.has(index)
          : selectedIndex === index;
        const isPlayable = isDiscardMode || playableSet.size === 0 || playableSet.has(index);

        const handleClick = () => {
          if (isDiscardMode && onToggleDiscard) {
            onToggleDiscard(index);
          } else {
            onSelectCard(isSelected ? -1 : index);
          }
        };

        const cardStyle = styles.card({ selected: isSelected, playable: isPlayable, discardMode: isDiscardMode });

        return (
          <div
            key={index}
            onClick={handleClick}
            style={{
              ...cardStyle,
              padding: '12px 16px',
              minWidth: 80,
              textAlign: 'center',
              transition: 'all 0.2s',
              transform: isSelected ? 'translateY(-8px)' : 'none',
              opacity: isPlayable ? 1 : 0.5,
              cursor: isPlayable ? 'pointer' : 'not-allowed',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 'bold', color: cardColor(card) }}>
              {card.name}
            </div>
            <div style={{ fontSize: 12, color: colors.text.muted }}>{card.suit}{card.rank}</div>
          </div>
        );
      })}
      {hand.length === 0 && (
        <div style={{ color: colors.text.dim, fontSize: 14 }}>没有手牌</div>
      )}
    </div>
  );
}

export const HandCards = memo(HandCardsInner);

function cardColor(card: Card): string {
  switch (card.name) {
    case '杀': return colors.accent.red;
    case '闪': return colors.accent.gold;
    case '桃': return colors.accent.green;
    default: return colors.text.input;
  }
}
