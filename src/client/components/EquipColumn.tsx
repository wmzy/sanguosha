// src/client/components/EquipColumn.tsx
// 装备区独立纵向列(布局最左侧)。
// 布局:武器 → 防具 → [进攻马|防御马] 并排 → 宝物。
// distribute(制衡/仁德)激活时,候选装备可点击选中,与手牌候选高亮一致。

import { memo } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { EquipSlot, GameView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import { isActiveAction } from '../utils/gameViewHelpers';
import { EQUIPMENT_SKILL_NAMES, EQUIP_SLOT_ICON } from './gameViewConstants';
import { shallowSetEqual } from '../utils/memo';
import { getSkillDescription } from '../../engine/skill';
import { useSkillDescReady } from '../hooks/useSkillDescReady';
import { useHoverTooltip } from './SkillTooltip';

/** 空槽短标签(马槽并排时用短名) */
const EMPTY_SLOT_LABEL: Record<EquipSlot, string> = {
  武器: '武器',
  防具: '防具',
  进攻马: '进攻',
  防御马: '防御',
  宝物: '宝物',
};

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

export function EquipColumnImpl({
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
  useSkillDescReady();
  const p = view.players[perspectiveIdx];
  if (!p) return null;

  const equipSkillActions = skillActions.filter((a) => EQUIPMENT_SKILL_NAMES.has(a.skillId));
  const actionCtx = { view, perspectiveIdx };
  const activeSkillByEquipName = new Map<string, SkillActionDef>();
  for (const a of equipSkillActions) {
    if (canOperate && isActiveAction(a, actionCtx)) activeSkillByEquipName.set(a.skillId, a);
  }

  const renderSlot = (slot: EquipSlot) => {
    const cardId = p.equipment[slot];
    const icon = EQUIP_SLOT_ICON[slot] ?? '💎';
    if (!cardId) {
      return (
        <div key={slot} className={cx(styles.equipColumnItem, styles.equipSlotEmpty)}>
          <span className={styles.equipColumnIcon}>{icon}</span>
          <span className={styles.equipSlotEmptyLabel}>{EMPTY_SLOT_LABEL[slot]}</span>
        </div>
      );
    }
    const id = cardId;
    const card = view.cardMap[id];
    const name = card?.name ?? id;
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
    const equipDesc = EQUIPMENT_SKILL_NAMES.has(name) ? getSkillDescription(name) : undefined;
    const head = `${name}(${slot})${stateHint}`;
    const tooltipText = equipDesc ? `${head}\n${equipDesc}` : head;
    return (
      <EquipItem
        key={slot}
        icon={icon}
        name={name}
        tooltipText={card ? tooltipText : id}
        activeSkill={activeSkill}
        isDistCandidate={isDistCandidate}
        isDistSelected={isDistSelected}
        clickable={clickable}
        handleClick={handleClick}
      />
    );
  };

  return (
    <div className={styles.equipColumn}>
      <div className={styles.equipColumnTitle}>装备区</div>
      <div className={styles.equipColumnList}>
        {renderSlot('武器')}
        {renderSlot('防具')}
        <div className={styles.equipHorseRow}>
          {renderSlot('进攻马')}
          {renderSlot('防御马')}
        </div>
        {renderSlot('宝物')}
      </div>
    </div>
  );
}

/** 单个装备卡片(含 hover tooltip)。提取为子组件以遵守 hooks 规则。 */
function EquipItem({
  icon,
  name,
  tooltipText,
  activeSkill,
  isDistCandidate,
  isDistSelected,
  clickable,
  handleClick,
}: {
  icon: string;
  name: string;
  tooltipText: string;
  activeSkill: SkillActionDef | undefined;
  isDistCandidate: boolean;
  isDistSelected: boolean;
  clickable: boolean;
  handleClick: (() => void) | undefined;
}) {
  const tip = useHoverTooltip(tooltipText);
  return (
    <>
      <div
        className={cx(
          styles.equipColumnItem,
          activeSkill && styles.equipSkillActive,
          isDistCandidate && styles.equipDistCandidate,
          isDistSelected && styles.equipSelected,
        )}
        role={clickable ? 'button' : undefined}
        onClick={handleClick}
        onMouseEnter={tip.onMouseEnter}
        onMouseLeave={tip.onMouseLeave}
      >
        <span className={styles.equipColumnIcon}>{icon}</span>
        <span className={styles.equipItemName}>{name}</span>
        {activeSkill && <span className={styles.equipSkillBadge}>⚡</span>}
      </div>
      {tip.tooltip}
    </>
  );
}

/** memo: 装备区只在装备/技能可用性/distribute 状态变化时重渲染 */
function equipColumnPropsEqual(prev: EquipColumnProps, next: EquipColumnProps): boolean {
  const prevP = prev.view.players[prev.perspectiveIdx];
  const nextP = next.view.players[next.perspectiveIdx];
  if (!prevP || !nextP) return prevP === nextP;
  const prevKeys = Object.keys(prevP.equipment);
  const nextKeys = Object.keys(nextP.equipment);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const k of prevKeys) {
    if (
      prevP.equipment[k as keyof typeof prevP.equipment] !==
      nextP.equipment[k as keyof typeof nextP.equipment]
    )
      return false;
  }
  return (
    prev.perspectiveIdx === next.perspectiveIdx &&
    prev.canOperate === next.canOperate &&
    prev.skillActions === next.skillActions &&
    prev.onSkillAction === next.onSkillAction &&
    prev.onEquipCardClick === next.onEquipCardClick &&
    prev.isDistributeActive === next.isDistributeActive &&
    shallowSetEqual(prev.distCandidateEquipIds ?? new Set(), next.distCandidateEquipIds ?? new Set()) &&
    shallowSetEqual(prev.distSelectedEquipIds ?? new Set(), next.distSelectedEquipIds ?? new Set()) &&
    prev.view.phase === next.view.phase
  );
}

export const EquipColumn = memo(EquipColumnImpl, equipColumnPropsEqual);
