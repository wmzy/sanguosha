import type { Player } from '../../shared/types';

interface PlayerPanelProps {
  player: Player;
  isCurrentPlayer: boolean;
  isSelf: boolean;
}

export function PlayerPanel({ player, isCurrentPlayer, isSelf }: PlayerPanelProps) {
  return (
    <div
      style={{
        border: isCurrentPlayer ? '2px solid #e74c3c' : '2px solid #34495e',
        borderRadius: 8,
        padding: 12,
        minWidth: 140,
        backgroundColor: isSelf ? '#2c3e50' : '#1a252f',
        color: '#ecf0f1',
        opacity: player.alive ? 1 : 0.5,
      }}
    >
      <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 4 }}>
        {player.character.name}
        {isSelf && <span style={{ fontSize: 12, color: '#3498db' }}> (你)</span>}
        {!player.alive && <span style={{ fontSize: 12, color: '#e74c3c' }}> (阵亡)</span>}
      </div>
      <div style={{ fontSize: 14, color: '#e74c3c' }}>
        体力: {'❤️'.repeat(player.health)}{'🖤'.repeat(player.maxHealth - player.health)}
        <span style={{ fontSize: 12 }}> {player.health}/{player.maxHealth}</span>
      </div>
      <div style={{ fontSize: 12, color: '#95a5a6' }}>
        身份: {isSelf ? player.role : '???'}
      </div>
      <div style={{ fontSize: 12, color: '#bdc3c7' }}>
        手牌: {player.hand.length} 张
      </div>
      {(Object.values(player.equipment).some(Boolean)) && (
        <div style={{ marginTop: 4, borderTop: '1px solid #34495e', paddingTop: 4 }}>
          {player.equipment.weapon && <div style={{ fontSize: 11, color: '#f39c12' }}>🗡 {player.equipment.weapon.name}</div>}
          {player.equipment.armor && <div style={{ fontSize: 11, color: '#27ae60' }}>🛡 {player.equipment.armor.name}</div>}
          {player.equipment.horsePlus && <div style={{ fontSize: 11, color: '#3498db' }}>🐎+ {player.equipment.horsePlus.name}</div>}
          {player.equipment.horseMinus && <div style={{ fontSize: 11, color: '#e67e22' }}>🐎- {player.equipment.horseMinus.name}</div>}
        </div>
      )}
    </div>
  );
}
