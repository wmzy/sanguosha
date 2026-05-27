// src/components/HandCards.tsx
import type { Card } from '../../shared/类型';

interface HandCardsProps {
  手牌: Card[];
  选中索引: number | null;
  选择卡牌: (索引: number) => void;
}

export function HandCards({ 手牌, 选中索引, 选择卡牌 }: HandCardsProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
      {手牌.map((卡牌, 索引) => (
        <div
          key={索引}
          onClick={() => 选择卡牌(选中索引 === 索引 ? -1 : 索引)}
          style={{
            border: 选中索引 === 索引 ? '2px solid #e74c3c' : '2px solid #7f8c8d',
            borderRadius: 8,
            padding: '12px 16px',
            backgroundColor: 选中索引 === 索引 ? '#34495e' : '#2c3e50',
            cursor: 'pointer',
            minWidth: 80,
            textAlign: 'center',
            transition: 'all 0.2s',
            transform: 选中索引 === 索引 ? 'translateY(-8px)' : 'none',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 'bold', color: 卡牌颜色(卡牌) }}>
            {卡牌.name}
          </div>
          <div style={{ fontSize: 12, color: '#95a5a6' }}>{卡牌.花色}{卡牌.点数}</div>
        </div>
      ))}
      {手牌.length === 0 && (
        <div style={{ color: '#7f8c8d', fontSize: 14 }}>没有手牌</div>
      )}
    </div>
  );
}

function 卡牌颜色(卡牌: Card): string {
  switch (卡牌.name) {
    case '杀': return '#e74c3c';
    case '闪': return '#f1c40f';
    case '桃': return '#2ecc71';
    default: return '#ecf0f1';
  }
}
