// src/components/PlayerPanel.tsx — 玩家面板
//
// 接受 PlayerView 派生数据（SelfView 或 OtherPlayerView），不再依赖引擎内部 PlayerState。
// 自/他 两种形态用判别联合表达，编译期保证正确处理。

import { memo } from 'react';
import type { AbilityConfig } from '../../shared/types';
import type { SelfView, OtherPlayerView, CardInfo } from '../../engine/view/types';
import { colors } from '../theme';

/** 面板数据：self 视角有完整手牌/装备，other 视角只有摘要。 */
export type PlayerPanelData =
  | { kind: 'self'; data: SelfView }
  | { kind: 'other'; data: OtherPlayerView };

interface PlayerPanelProps {
  playerName: string;
  data: PlayerPanelData;
  cardMap: Record<string, CardInfo>;
  isCurrentPlayer: boolean;
  isSelf: boolean;
  /** 身份（debug 模式可见） */
  role?: string;
  seatNumber?: number;
  distance?: number;
  /** 剩余秒数（仅等待操作的玩家有值） */
  timerSeconds?: number;
  /** 角色技能列表 */
  abilities?: AbilityConfig[];
}

function PlayerPanelInner({
  playerName: _playerName,
  data,
  cardMap,
  isCurrentPlayer,
  isSelf,
  role,
  seatNumber,
  distance,
  timerSeconds,
  abilities,
}: PlayerPanelProps) {
  const isSelfPanel = data.kind === 'self';
  const health = data.data.health;
  const maxHealth = data.data.maxHealth;
  const alive = data.data.alive;

  const handCount = isSelfPanel
    ? data.data.hand.length
    : data.data.handCount;
  const hasEquipment =
    data.data.equipment.weapon !== null ||
    data.data.equipment.armor !== null ||
    data.data.equipment.mount !== null;
  const pendingTrickCount = isSelfPanel
    ? data.data.pendingTricks.length
    : data.data.pendingTrickCount;

  const timerLabel = timerSeconds !== undefined
    ? `${Math.floor(timerSeconds / 60)}:${(timerSeconds % 60).toString().padStart(2, '0')}`
    : null;
  const timerColor = timerSeconds !== undefined && timerSeconds <= 10 ? colors.accent.red : colors.accent.green;

  const equipName = (slot: 'weapon' | 'armor' | 'mount'): string | null => {
    return data.data.equipment[slot]?.name ?? null;
  };

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
        opacity: alive ? 1 : 0.5,
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
        {data.data.characterId}
        {isSelf && <span style={{ fontSize: 12, color: colors.accent.blue }}> (你)</span>}
        {!alive && <span style={{ fontSize: 12, color: colors.accent.red }}> (阵亡)</span>}
      </div>
      <div style={{ fontSize: 14, color: colors.accent.red }}>
        体力: {'❤️'.repeat(health)}{'🖤'.repeat(maxHealth - health)}
        <span style={{ fontSize: 12 }}> {health}/{maxHealth}</span>
      </div>
      {(role !== undefined || !isSelf) && (
        <div style={{ fontSize: 12, color: colors.text.muted }}>
          身份: {isSelf || !alive ? role : '???'}
        </div>
      )}
      <div style={{ fontSize: 12, color: colors.text.secondary }}>
        手牌: {handCount} 张
      </div>
      {distance !== undefined && (
        <div style={{ fontSize: 11, color: colors.accent.orange }}>
          距离: {distance}
        </div>
      )}
      {hasEquipment && (
        <div style={{ marginTop: 6, borderTop: `1px solid ${colors.bg.input}`, paddingTop: 6 }}>
          <div style={{ fontSize: 11, color: colors.text.dim, marginBottom: 2 }}>装备:</div>
          {equipName('weapon') && (
            <div style={{ fontSize: 13, color: colors.accent.amber, marginBottom: 2 }}>
              🗡 {equipName('weapon')}
              {isSelfPanel && data.data.equipment.weapon?.id && (() => {
                const card = cardMap[data.data.equipment.weapon.id];
                const range = typeof card?.range === 'number' ? card.range : undefined;
                return range ? <span style={{ fontSize: 11, color: colors.text.muted }}> (范围{range})</span> : null;
              })()}
            </div>
          )}
          {equipName('armor') && (
            <div style={{ fontSize: 13, color: colors.accent.greenDark, marginBottom: 2 }}>
              🛡 {equipName('armor')}
            </div>
          )}
          {equipName('mount') && (
            <div style={{ fontSize: 13, color: colors.accent.blue, marginBottom: 2 }}>
              🐎+ {equipName('mount')}
            </div>
          )}
        </div>
      )}
      {(isSelfPanel ? data.data.pendingTricks.length > 0 : pendingTrickCount > 0) && (
        <div style={{ marginTop: 6, borderTop: `1px solid ${colors.bg.input}`, paddingTop: 6 }}>
          <div style={{ fontSize: 11, color: colors.text.dim, marginBottom: 2 }}>判定区:</div>
          {isSelfPanel && data.data.pendingTricks.map((trick, i) => (
            <div key={i} style={{ fontSize: 12, color: colors.accent.purple, marginBottom: 1 }}>
              ⏳ {trick.name}
            </div>
          ))}
          {!isSelfPanel && (
            <div style={{ fontSize: 12, color: colors.accent.purple }}>⏳ 判定中</div>
          )}
        </div>
      )}
      {isSelfPanel && data.data.tags.length > 0 && (
        <div style={{ marginTop: 6, borderTop: `1px solid ${colors.bg.input}`, paddingTop: 6 }}>
          <div style={{ fontSize: 11, color: colors.text.dim, marginBottom: 2 }}>标记:</div>
          {data.data.tags.map((tag) => (
            <span key={tag} style={{ fontSize: 11, color: colors.accent.amber, marginRight: 4 }}>🏷 {tag}</span>
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

export const PlayerPanel = memo(PlayerPanelInner);
