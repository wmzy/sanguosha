import type { Card } from '../../shared/types';

interface HandCardsProps {
  hand: Card[];
  selectedIndex: number | null;
  onSelectCard: (index: number) => void;
  playableIndices?: number[]; // 可出的牌的索引
}

export function HandCards({ hand, selectedIndex, onSelectCard, playableIndices }: HandCardsProps) {
  const playableSet = new Set(playableIndices ?? []);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
      {hand.map((card, index) => {
        const isSelected = selectedIndex === index;
        const isPlayable = playableSet.size === 0 || playableSet.has(index); // 没有指定时全部可选

        return (
          <div
            key={index}
            onClick={() => onSelectCard(isSelected ? -1 : index)}
            style={{
              border: isSelected ? '2px solid #e74c3c' : isPlayable ? '2px solid #555' : '2px solid #333',
              borderRadius: 8,
              padding: '12px 16px',
              backgroundColor: isSelected ? '#34495e' : isPlayable ? '#2c3e50' : '#1a1a2e',
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
