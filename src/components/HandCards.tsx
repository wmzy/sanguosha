import type { Card } from '../../shared/types';

interface HandCardsProps {
  hand: Card[];
  selectedIndex: number | null;
  onSelectCard: (index: number) => void;
  playableIndices?: number[];
  discardSelectedIndices?: Set<number>;
  onToggleDiscard?: (index: number) => void;
}

export function HandCards({
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

        return (
          <div
            key={index}
            onClick={handleClick}
            style={{
              border: isSelected
                ? isDiscardMode ? '2px solid #8e44ad' : '2px solid #e74c3c'
                : isPlayable ? '2px solid #555' : '2px solid #333',
              borderRadius: 8,
              padding: '12px 16px',
              backgroundColor: isSelected
                ? isDiscardMode ? '#4a235a' : '#34495e'
                : isPlayable ? '#2c3e50' : '#1a1a2e',
              cursor: isPlayable ? 'pointer' : 'not-allowed',
              minWidth: 80,
              textAlign: 'center',
              transition: 'all 0.2s',
              transform: isSelected ? 'translateY(-8px)' : 'none',
              opacity: isPlayable ? 1 : 0.5,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 'bold', color: cardColor(card) }}>
              {card.name}
            </div>
            <div style={{ fontSize: 12, color: '#95a5a6' }}>{card.suit}{card.rank}</div>
          </div>
        );
      })}
      {hand.length === 0 && (
        <div style={{ color: '#7f8c8d', fontSize: 14 }}>没有手牌</div>
      )}
    </div>
  );
}

function cardColor(card: Card): string {
  switch (card.name) {
    case '杀': return '#e74c3c';
    case '闪': return '#f1c40f';
    case '桃': return '#2ecc71';
    default: return '#ecf0f1';
  }
}
