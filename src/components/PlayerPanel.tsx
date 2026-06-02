import type { PlayerState, EquipmentSlots } from '../../engine/types';
import type { Card, AbilityConfig } from '../../shared/types';
import { colors } from '../theme';

interface PlayerPanelProps {
  playerName: string;
  player: PlayerState;
  cardMap: Record<string, Card>;
  isCurrentPlayer: boolean;
  isSelf: boolean;
  seatNumber?: number;
  distance?: number;
  /** 剩余秒数（仅等待操作的玩家有值） */
  timerSeconds?: number;
  /** 角色技能列表 */
  abilities?: AbilityConfig[];
}

export function PlayerPanel({ playerName: _playerName, player, cardMap, isCurrentPlayer, isSelf, seatNumber, distance, timerSeconds, abilities }: PlayerPanelProps) {
  const equipmentNames = getEquipmentNames(player.equipment, cardMap);
  const hasEquipment = Object.values(player.equipment).some(Boolean);

  const timerLabel = timerSeconds !== undefined
    ? `${Math.floor(timerSeconds / 60)}:${(timerSeconds % 60).toString().padStart(2, '0')}`
    : null;
  const timerColor = timerSeconds !== undefined && timerSeconds <= 10 ? colors.accent.red : colors.accent.green;

  return (
    <div
      style={{
        position: 'relative',
        border: isCurrentPlayer ? `2px solid ${colors.accent.red}` : `2px solid ${colors.bg.input}`,
        borderRadius: 8,
        padding: 12,
        minWidth: 160,
        backgroundColor: isSelf ? colors.bg.playerSelf : colors.bg.playerOther,
        color: colors.text.input,
        opacity: player.info.alive ? 1 : 0.5,
      }}
    >
      {timerSeconds !== undefined && (
        <div
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            backgroundColor: timerColor,
            color: colors.white,
            fontSize: 11,
            fontWeight: 'bold',
            fontFamily: 'monospace',
            padding: '2px 6px',
            borderRadius: 10,
            lineHeight: '14px',
          }}
        >
          {timerLabel}
        </div>
      )}
      <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 4 }}>
        {seatNumber !== undefined && <span style={{ fontSize: 12, color: colors.text.dim, marginRight: 4 }}>#{seatNumber}</span>}
        {player.info.characterId}
        {isSelf && <span style={{ fontSize: 12, color: colors.accent.blue }}> (你)</span>}
        {!player.info.alive && <span style={{ fontSize: 12, color: colors.accent.red }}> (阵亡)</span>}
      </div>
      <div style={{ fontSize: 14, color: colors.accent.red }}>
        体力: {'❤️'.repeat(player.health)}{'🖤'.repeat(player.maxHealth - player.health)}
        <span style={{ fontSize: 12 }}> {player.health}/{player.maxHealth}</span>
      </div>
      <div style={{ fontSize: 12, color: colors.text.muted }}>
        身份: {isSelf || !player.info.alive ? player.info.role : '???'}
      </div>
      <div style={{ fontSize: 12, color: colors.text.secondary }}>
        手牌: {player.hand.length} 张
      </div>
      {distance !== undefined && (
        <div style={{ fontSize: 11, color: colors.accent.orange }}>
          距离: {distance}
        </div>
      )}
      {hasEquipment && (
        <div style={{ marginTop: 6, borderTop: `1px solid ${colors.bg.input}`, paddingTop: 6 }}>
          <div style={{ fontSize: 11, color: colors.text.dim, marginBottom: 2 }}>装备:</div>
          {player.equipment.weapon && (
            <div style={{ fontSize: 13, color: colors.accent.amber, marginBottom: 2 }}>
              🗡 {equipmentNames.weapon}
              {cardMap[player.equipment.weapon]?.range && <span style={{ fontSize: 11, color: colors.text.muted }}> (范围{cardMap[player.equipment.weapon].range})</span>}
            </div>
          )}
          {player.equipment.armor && (
            <div style={{ fontSize: 13, color: colors.accent.greenDark, marginBottom: 2 }}>
              🛡 {equipmentNames.armor}
            </div>
          )}
          {player.equipment.horsePlus && (
            <div style={{ fontSize: 13, color: colors.accent.blue, marginBottom: 2 }}>
              🐎+ {equipmentNames.horsePlus}
            </div>
          )}
          {player.equipment.horseMinus && (
            <div style={{ fontSize: 13, color: colors.accent.orange, marginBottom: 2 }}>
              🐎- {equipmentNames.horseMinus}
            </div>
          )}
        </div>
      )}
      {player.pendingTricks.length > 0 && (
        <div style={{ marginTop: 6, borderTop: `1px solid ${colors.bg.input}`, paddingTop: 6 }}>
          <div style={{ fontSize: 11, color: colors.text.dim, marginBottom: 2 }}>判定区:</div>
          {player.pendingTricks.map((trick, i) => (
            <div key={i} style={{ fontSize: 12, color: colors.accent.purple, marginBottom: 1 }}>
              ⏳ {trick.name} ({trick.card.suit}{trick.card.rank})
            </div>
          ))}
        </div>
      )}
      {abilities && abilities.length > 0 && (
        <div style={{ marginTop: 6, borderTop: `1px solid ${colors.bg.input}`, paddingTop: 6 }}>
          <div style={{ fontSize: 11, color: colors.text.dim, marginBottom: 2 }}>技能:</div>
          {abilities.map((a) => (
            <div key={a.name} style={{ marginBottom: 2 }}>
              <span style={{ fontSize: 12, color: colors.accent.amber, fontWeight: 'bold' }}>
                {a.name}
                {a.passive && <span style={{ color: colors.text.dim, fontWeight: 'normal' }}> (被动)</span>}
                {a.oncePerTurn && <span style={{ color: colors.text.dim, fontWeight: 'normal' }}> (限一次)</span>}
              </span>
              <div style={{ fontSize: 11, color: colors.text.muted, lineHeight: '14px' }}>
                {a.description}
              </div>
            </div>
          ))}
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
