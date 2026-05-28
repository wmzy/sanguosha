// src/components/HandCards.tsx
import type { Card } from '../../shared/types';

interface HandCardsProps {
  hand: Card[];
  selectedIndex: number | null;
  onSelectCard: (index: number) => void;
}

export function HandCards({ hand, selectedIndex, onSelectCard }: HandCardsProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
      {hand.map((card, index) => (
        <div
          key={index}
          onClick={() => onSelectCard(selectedIndex === index ? -1 : index)}
          style={{
            border: selectedIndex === index ? '2px solid #e74c3c' : '2px solid #7f8c8d',
            borderRadius: 8,
            padding: '12px 16px',
            backgroundColor: selectedIndex === index ? '#34495e' : '#2c3e50',
            cursor: 'pointer',
            minWidth: 80,
            textAlign: 'center',
            transition: 'all 0.2s',
            transform: selectedIndex === index ? 'translateY(-8px)' : 'none',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 'bold', color: cardColor(card) }}>
            {card.name}
          </div>
          <div style={{ fontSize: 12, color: '#95a5a6' }}>{card.suit}{card.rank}</div>
        </div>
      ))}
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
