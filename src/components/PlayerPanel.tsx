import type { PlayerState, EquipmentSlots } from '../../engine/v2/types';
import type { Card } from '../../shared/types';

interface PlayerPanelProps {
  playerName: string;
  player: PlayerState;
  cardMap: Record<string, Card>;
  isCurrentPlayer: boolean;
  isSelf: boolean;
  seatNumber?: number;
  distance?: number;
}

export function PlayerPanel({ playerName, player, cardMap, isCurrentPlayer, isSelf, seatNumber, distance }: PlayerPanelProps) {
  const equipmentNames = getEquipmentNames(player.equipment, cardMap);
  const hasEquipment = Object.values(player.equipment).some(Boolean);

  return (
    <div
      style={{
        border: isCurrentPlayer ? '2px solid #e74c3c' : '2px solid #34495e',
        borderRadius: 8,
        padding: 12,
        minWidth: 160,
        backgroundColor: isSelf ? '#2c3e50' : '#1a252f',
        color: '#ecf0f1',
        opacity: player.info.alive ? 1 : 0.5,
      }}
    >
      <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 4 }}>
        {seatNumber !== undefined && <span style={{ fontSize: 12, color: '#7f8c8d', marginRight: 4 }}>#{seatNumber}</span>}
        {player.info.characterId}
        {isSelf && <span style={{ fontSize: 12, color: '#3498db' }}> (你)</span>}
        {!player.info.alive && <span style={{ fontSize: 12, color: '#e74c3c' }}> (阵亡)</span>}
      </div>
      <div style={{ fontSize: 14, color: '#e74c3c' }}>
        体力: {'❤️'.repeat(player.health)}{'🖤'.repeat(player.maxHealth - player.health)}
        <span style={{ fontSize: 12 }}> {player.health}/{player.maxHealth}</span>
      </div>
      <div style={{ fontSize: 12, color: '#95a5a6' }}>
        身份: {isSelf || !player.info.alive ? player.info.role : '???'}
      </div>
      <div style={{ fontSize: 12, color: '#bdc3c7' }}>
        手牌: {player.hand.length} 张
      </div>
      {distance !== undefined && (
        <div style={{ fontSize: 11, color: '#e67e22' }}>
          距离: {distance}
        </div>
      )}
      {hasEquipment && (
        <div style={{ marginTop: 6, borderTop: '1px solid #34495e', paddingTop: 6 }}>
          <div style={{ fontSize: 11, color: '#7f8c8d', marginBottom: 2 }}>装备:</div>
          {player.equipment.weapon && (
            <div style={{ fontSize: 13, color: '#f39c12', marginBottom: 2 }}>
              🗡 {equipmentNames.weapon}
              {cardMap[player.equipment.weapon]?.range && <span style={{ fontSize: 11, color: '#95a5a6' }}> (范围{cardMap[player.equipment.weapon].range})</span>}
            </div>
          )}
          {player.equipment.armor && (
            <div style={{ fontSize: 13, color: '#27ae60', marginBottom: 2 }}>
              🛡 {equipmentNames.armor}
            </div>
          )}
          {player.equipment.horsePlus && (
            <div style={{ fontSize: 13, color: '#3498db', marginBottom: 2 }}>
              🐎+ {equipmentNames.horsePlus}
            </div>
          )}
          {player.equipment.horseMinus && (
            <div style={{ fontSize: 13, color: '#e67e22', marginBottom: 2 }}>
              🐎- {equipmentNames.horseMinus}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getEquipmentNames(equipment: EquipmentSlots, cardMap: Record<string, Card>): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [slot, cardId] of Object.entries(equipment)) {
    if (cardId && cardMap[cardId]) {
      names[slot] = cardMap[cardId].name;
    }
  }
  return names;
}
