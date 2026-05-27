// src/components/PlayerPanel.tsx
import type { Player } from '../../shared/类型';

interface PlayerPanelProps {
  玩家: Player;
  是当前玩家: boolean;
  是自己: boolean;
}

export function PlayerPanel({ 玩家, 是当前玩家, 是自己 }: PlayerPanelProps) {
  return (
    <div
      style={{
        border: 是当前玩家 ? '2px solid #e74c3c' : '2px solid #34495e',
        borderRadius: 8,
        padding: 12,
        minWidth: 120,
        backgroundColor: 是自己 ? '#2c3e50' : '#1a252f',
        color: '#ecf0f1',
        opacity: 玩家.存活 ? 1 : 0.5,
      }}
    >
      <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 4 }}>
        {玩家.角色.name}
        {是自己 && <span style={{ fontSize: 12, color: '#3498db' }}> (你)</span>}
      </div>
      <div style={{ fontSize: 14, color: '#e74c3c' }}>
        体力: {'❤️'.repeat(玩家.体力)}{'🖤'.repeat(玩家.体力上限 - 玩家.体力)}
      </div>
      <div style={{ fontSize: 12, color: '#95a5a6' }}>
        身份: {是自己 ? 玩家.身份 : '???'}
      </div>
      <div style={{ fontSize: 12, color: '#bdc3c7' }}>
        手牌: {玩家.手牌.length} 张
      </div>
      {玩家.装备.武器 && <div style={{ fontSize: 11, color: '#f39c12' }}>🗡 {玩家.装备.武器.name}</div>}
      {玩家.装备.防具 && <div style={{ fontSize: 11, color: '#27ae60' }}>🛡 {玩家.装备.防具.name}</div>}
    </div>
  );
}
