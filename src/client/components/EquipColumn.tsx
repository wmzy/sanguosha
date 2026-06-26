// src/client/components/EquipColumn.tsx
// 装备区独立纵向列(布局最左侧)。
// 从 PlayerCardLarge.tsx 抽出装备区渲染,改为纵向排列。
// 纯展示组件,所有数据/回调由父组件(GameView)传入。
//
// 包含:装备槽位(武器/防具/马,纵向堆叠) + 装备技能按钮(可主动点击的装备技)。
// distribute(制衡/仁德)激活时,候选装备可点击选中,与手牌候选高亮一致。

import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { EquipSlot, GameView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import { isActiveAction } from '../utils/gameViewHelpers';
import { EQUIPMENT_SKILL_NAMES, EQUIP_SLOT_ICON } from './gameViewConstants';

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

  const equipEntries = Object.entries(p.equipment);
  // 装备技能:动态装备的技能可主动点击
  const equipSkillActions = skillActions.filter((a) => EQUIPMENT_SKILL_NAMES.has(a.skillId));
  const actionCtx = { view, perspectiveIdx };
  const isSkillActive = (a: SkillActionDef) => canOperate && isActiveAction(a, actionCtx);

  const activeEquipSkills = equipSkillActions.filter(isSkillActive);
  const hasEquip = equipEntries.length > 0;
  // 无装备也无可用装备技能时不渲染整列
  if (!hasEquip && activeEquipSkills.length === 0) return null;

  return (
    <div className={styles.equipColumn}>
      <div className={styles.equipColumnTitle}>装备区</div>
      <div className={styles.equipColumnList}>
        {hasEquip ? (
          equipEntries.map(([slot, cardId]) => {
            const id = cardId as string;
            const card = view.cardMap[id];
            const icon = EQUIP_SLOT_ICON[slot as EquipSlot] ?? '💎';
            // distribute 候选装备:可点击选中
            const isDistCandidate = !!isDistributeActive && !!distCandidateEquipIds?.has(id);
            const isDistSelected = !!distSelectedEquipIds?.has(id);
            if (isDistCandidate && onEquipCardClick) {
              return (
                <button
                  key={slot}
                  type="button"
                  className={cx(styles.equipDistBtn, isDistSelected && styles.equipDistSelected)}
                  onClick={() => onEquipCardClick(id)}
                  title={card ? `${card.name}(${slot})` : id}
                >
                  {icon} {card?.name ?? id}
                </button>
              );
            }
            return (
              <div
                key={slot}
                className={styles.equipColumnItem}
                title={card ? `${card.name}(${slot})` : String(cardId)}
              >
                <span className={styles.equipColumnIcon}>{icon}</span>
                <span>{card?.name ?? cardId}</span>
              </div>
            );
          })
        ) : (
          <div className={styles.equipColumnEmpty}>无装备</div>
        )}
        {activeEquipSkills.map((a) => (
          <button
            key={`${a.skillId}:${a.actionType}`}
            className={styles.equipSkillBtn}
            onClick={() => onSkillAction(a)}
            title={`${a.label}: ${a.prompt.title}`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
