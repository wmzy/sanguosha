// src/client/components/EquipColumn.tsx
// 装备区独立纵向列(布局最左侧)。
// 布局:武器 → 防具 → [进攻马|防御马] 并排 → 宝物。
// distribute(制衡/仁德)激活时,候选装备可点击选中,与手牌候选高亮一致。
// 共享数据(view/perspectiveIdx/canOperate/skillActions)来自 GameViewCtx,专属数据仍走
// props。为保留 memo comparator 采用「context 消费壳 + 内部 memo impl」模式。

import { memo } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { EquipSlot, GameView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import { isActiveAction } from '../utils/gameViewHelpers';
import { EQUIPMENT_SKILL_NAMES, EQUIP_SLOT_ICON } from './gameViewConstants';
import { getEquipCardImage } from '../assets/imageAssets';
import { shallowSetEqual } from '../utils/memo';
import { getSkillDescription } from '../../engine/skills/lifecycle';
import { useSkillDescReady } from '../hooks/useSkillDescReady';
import { useHoverTooltip } from '../hooks/useHoverTooltip';
import { useGameView } from './GameViewCtx';

/** 空槽短标签(马槽并排时用短名) */
const EMPTY_SLOT_LABEL: Record<EquipSlot, string> = {
  武器: '武器',
  防具: '防具',
  进攻马: '进攻',
  防御马: '防御',
  宝物: '宝物',
};

export interface EquipColumnProps {
  /** 点击装备技能按钮 */
  onSkillAction: (action: SkillActionDef) => void;
  /** distribute(制衡/仁德)激活时可作为候选的装备 cardId 集合 */
  distCandidateEquipIds?: Set<string> | null;
  /** distribute 已选中的装备 cardId 集合 */
  distSelectedEquipIds?: Set<string> | null;
  /** distribute 是否激活(决定装备区是否可点选) */
  isDistributeActive?: boolean;
  /** 点击装备区卡牌(distribute 选装备 / 回应窗口选装备候选时触发) */
  onEquipCardClick?: (cardId: string) => void;
  /** 回应窗口可作为候选的装备 cardId 集合(界天香弃红桃装备/界鬼才换判定牌);
   *  null = 非回应选牌窗口(装备区保持装备技能按钮语义) */
  respondCandidateEquipIds?: Set<string> | null;
  /** 回应窗口已选中的装备 cardId(与手牌 selectedRespondCardId 同源) */
  selectedRespondEquipId?: string | null;
}

/** 内部 memo impl 的 props(含从 context 转发下来的共享字段)。 */
interface EquipColumnImplProps extends EquipColumnProps {
  /** 视角玩家在 view.players 中的下标 */
  perspectiveIdx: number;
  /** 引擎视图(取 players[perspectiveIdx].equipment / cardMap) */
  view: GameView;
  /** 是否可操作(debug 模式恒 true) */
  canOperate: boolean;
  /** 已注册的技能前端 actions(用于装备技能按钮) */
  skillActions: SkillActionDef[];
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
  respondCandidateEquipIds,
  selectedRespondEquipId,
}: EquipColumnImplProps) {
  useSkillDescReady();
  const p = view.players[perspectiveIdx];
  if (!p) return null;

  // 回应选牌窗口(distribute 同构):装备区整体切到「选牌候选」语义,抑制技能触发,
  // 避免候选装备的技能按钮抢占点击(候选牌点击走 onEquipCardClick → handleCardClick
  // 的回应选中分支)。
  const inRespondPick = respondCandidateEquipIds != null;
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
    // distribute 激活时:装备只作选牌候选,抑制技能触发(避免制衡选牌误弹装备技能
    // confirm 弹窗,如寒冰剑的 respond-confirm action 无 activeWhen 在出牌阶段被判 active)。
    // 回应选牌窗口(界天香/界鬼才)同理抑制,装备技能按钮让位给候选点选。
    const rawSkill = activeSkillByEquipName.get(name);
    const activeSkill = (isDistributeActive || inRespondPick) ? undefined : rawSkill;
    const isDistCandidate = !!isDistributeActive && !!distCandidateEquipIds?.has(id);
    const isDistSelected = !!distSelectedEquipIds?.has(id);
    const isRespondCandidate = inRespondPick && !!respondCandidateEquipIds?.has(id);
    const isRespondSelected = selectedRespondEquipId === id;
    const clickable = !!activeSkill || isDistCandidate || isRespondCandidate;
    const handleClick = activeSkill
      ? () => onSkillAction(activeSkill)
      : isDistCandidate || isRespondCandidate
        ? () => onEquipCardClick?.(id)
        : undefined;
    const stateHint = activeSkill
      ? ' · 可发动'
      : isDistCandidate || isRespondCandidate
        ? ' · 可选中'
        : '';
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
        isRespondCandidate={isRespondCandidate}
        isRespondSelected={isRespondSelected}
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
  isRespondCandidate,
  isRespondSelected,
  clickable,
  handleClick,
}: {
  icon: string;
  name: string;
  tooltipText: string;
  activeSkill: SkillActionDef | undefined;
  isDistCandidate: boolean;
  isDistSelected: boolean;
  /** 回应窗口:该装备是回应候选(界天香弃红桃装备/界鬼才换判定牌),可点击选中 */
  isRespondCandidate: boolean;
  /** 回应窗口:该装备已被选为回应牌(与手牌回应选中同源) */
  isRespondSelected: boolean;
  clickable: boolean;
  handleClick: (() => void) | undefined;
}) {
  const tip = useHoverTooltip(tooltipText);
  // 装备区小缩略图:cards-local 图片(<object> fallback)或 emoji 图标。
  const cardUrl = getEquipCardImage(name);
  return (
    <>
      <div
        className={cx(
          styles.equipColumnItem,
          activeSkill && styles.equipSkillActive,
          isDistCandidate && styles.equipDistCandidate,
          isDistSelected && styles.equipSelected,
          isRespondCandidate && styles.equipRespondCandidate,
          isRespondSelected && styles.equipRespondSelected,
        )}
        role={clickable ? 'button' : undefined}
        onClick={handleClick}
        onMouseEnter={tip.onMouseEnter}
        onMouseLeave={tip.onMouseLeave}
      >
        {cardUrl ? (
          <object
            className={styles.equipCardArt}
            data={cardUrl}
            aria-label={name}
          >
            {/* object 加载失败时渲染 emoji 图标 fallback */}
            <span className={styles.equipColumnIcon}>{icon}</span>
          </object>
        ) : (
          <span className={styles.equipColumnIcon}>{icon}</span>
        )}
        <span className={styles.equipItemName}>{name}</span>
        {activeSkill && <span className={styles.equipSkillBadge}>⚡</span>}
      </div>
      {tip.tooltip}
    </>
  );
}

/** memo: 装备区只在装备/技能可用性/distribute 状态变化时重渲染 */
function equipColumnPropsEqual(prev: EquipColumnImplProps, next: EquipColumnImplProps): boolean {
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
    prev.view.phase === next.view.phase &&
    // 回应窗口装备候选(界天香/界鬼才):候选集合或选中牌变化须重渲染
    shallowSetEqual(
      prev.respondCandidateEquipIds ?? new Set(),
      next.respondCandidateEquipIds ?? new Set(),
    ) &&
    prev.selectedRespondEquipId === next.selectedRespondEquipId
  );
}

const EquipColumnMemo = memo(EquipColumnImpl, equipColumnPropsEqual);

/** context 消费壳:共享数据(view/perspectiveIdx/canOperate/skillActions)来自
 *  GameViewCtx,转发给保持原 comparator 的 memo impl。 */
export function EquipColumn(props: EquipColumnProps) {
  const { view, perspectiveIdx, canOperate, skillActions } = useGameView();
  return (
    <EquipColumnMemo
      {...props}
      perspectiveIdx={perspectiveIdx}
      view={view}
      canOperate={canOperate}
      skillActions={skillActions}
    />
  );
}
