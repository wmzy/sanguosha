// src/client/components/EquipColumn.tsx
// 装备区独立纵向列(布局最左侧)。
// 从 PlayerCardLarge.tsx 抽出装备区渲染,改为纵向排列。
// 纯展示组件,所有数据/回调由父组件(GameView)传入。
//
// 包含:装备槽位(武器/防具/马,纵向堆叠) + 装备技能按钮(可主动点击的装备技)。
// distribute(制衡/仁德)激活时,候选装备可点击选中,与手牌候选高亮一致。

import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import { isActiveAction } from '../utils/gameViewHelpers';
import { EQUIPMENT_SKILL_NAMES, EQUIP_SLOT_ICON, EQUIP_SLOT_ORDER } from './gameViewConstants';

export interface EquipColumnProps {
  /** 视角玩家在 view.players 中的下标 */
  perspectiveIdx: number;
  /** 引擎视图(取 players[perspectiveIdx].equipment / cardMap) */
  view: GameView;
  /** 是否可操作(debug 模式恒 true) */
  canOperate: boolean;
  /** 已注册的技能前端 actions(用于装备技能按钮) */
  skillActions: SkillActionDef[];
  /** 点击装备技能按钮 */
  onSkillAction: (action: SkillActionDef) => void;
  /** distribute(制衡/仁德)激活时可作为候选的装备 cardId 集合 */
  distCandidateEquipIds?: Set<string> | null;
  /** distribute 已选中的装备 cardId 集合 */
  distSelectedEquipIds?: Set<string> | null;
  /** distribute 是否激活(决定装备区是否可点选) */
  isDistributeActive?: boolean;
  /** 点击装备区卡牌(distribute 选装备时触发) */
  onEquipCardClick?: (cardId: string) => void;
}

export function EquipColumn({
  perspectiveIdx,
  view,
  canOperate,
  skillActions,
  onSkillAction,
  distCandidateEquipIds,
  distSelectedEquipIds,
  isDistributeActive,
  onEquipCardClick,
}: EquipColumnProps) {
  const p = view.players[perspectiveIdx];
  if (!p) return null;

  // 装备技能:动态装备的技能可主动发动。skillId === 装备牌名(见 card-meta.ts)。
  // 将可发动的技能融合到对应装备卡片,不再在底部单独列出技能按钮。
  const equipSkillActions = skillActions.filter((a) => EQUIPMENT_SKILL_NAMES.has(a.skillId));
  const actionCtx = { view, perspectiveIdx };
  const activeSkillByEquipName = new Map<string, SkillActionDef>();
  for (const a of equipSkillActions) {
    if (canOperate && isActiveAction(a, actionCtx)) activeSkillByEquipName.set(a.skillId, a);
  }

  return (
    <div className={styles.equipColumn}>
      <div className={styles.equipColumnTitle}>装备区</div>
      <div className={styles.equipColumnList}>
        {EQUIP_SLOT_ORDER.map((slot) => {
          const cardId = p.equipment[slot];
          const icon = EQUIP_SLOT_ICON[slot] ?? '💎';
          // 空槽:固定占位卡框(布局稳定,不因装备数变化而抖动)
          if (!cardId) {
            return (
              <div key={slot} className={cx(styles.equipColumnItem, styles.equipSlotEmpty)}>
                <span className={styles.equipColumnIcon}>{icon}</span>
                <span className={styles.equipSlotEmptyLabel}>{slot}</span>
              </div>
            );
          }
          const id = cardId;
          const card = view.cardMap[id];
          const name = card?.name ?? id;
          // 三态:技能可发动 / distribute 候选 / 选中(向右偏移)
          const activeSkill = activeSkillByEquipName.get(name);
          const isDistCandidate = !!isDistributeActive && !!distCandidateEquipIds?.has(id);
          const isDistSelected = !!distSelectedEquipIds?.has(id);
          const clickable = !!activeSkill || isDistCandidate;
          const handleClick = activeSkill
            ? () => onSkillAction(activeSkill)
            : isDistCandidate
              ? () => onEquipCardClick?.(id)
              : undefined;
          const stateHint = activeSkill ? ' · 可发动' : isDistCandidate ? ' · 可选中' : '';
          return (
            <div
              key={slot}
              className={cx(
                styles.equipColumnItem,
                activeSkill && styles.equipSkillActive,
                isDistCandidate && styles.equipDistCandidate,
                isDistSelected && styles.equipSelected,
              )}
              role={clickable ? 'button' : undefined}
              onClick={handleClick}
              title={card ? `${name}(${slot})${stateHint}` : id}
            >
              <span className={styles.equipColumnIcon}>{icon}</span>
              <span>{name}</span>
              {activeSkill && <span className={styles.equipSkillBadge}>⚡</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
