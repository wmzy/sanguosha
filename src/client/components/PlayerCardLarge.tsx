// src/client/components/PlayerCardLarge.tsx
// 视角玩家角色大卡(势力/身份/体力/技能/装备/判定)。
// 从 GameView.tsx 抽出的纯展示组件——内部无状态,所有数据/回调由父组件传入。
import { memo } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import { isActiveAction } from '../utils/gameViewHelpers';
import { FACTION_BG, SUIT_COLOR, EQUIPMENT_SKILL_NAMES } from './gameViewConstants';
import { getCharacterMeta } from '../../engine/character-meta';
import { getSkillDescription } from '../../engine/skill';
import { useSkillDescReady } from '../hooks/useSkillDescReady';
import { SkillTag } from './SkillTooltip';
import { DEFAULT_SKILLS as ENGINE_DEFAULT_SKILLS } from '../../engine/atoms/选将';
import { playerVisibleEqual } from '../utils/memo';

const DEFAULT_SKILLS = new Set(ENGINE_DEFAULT_SKILLS);

export interface PlayerCardLargeProps {
  /** 视角玩家在 view.players 中的下标 */
  perspectiveIdx: number;
  /** viewer 座次(用于显示「我」徽章) */
  viewer: number;
  /** 引擎视图(取 players[perspectiveIdx] / cardMap / phase) */
  view: GameView;
  /** 动画状态(体力闪烁) */
  damageFlashIndices: Map<number, number>;
  /** 是否可操作(debug 模式恒 true) */
  canOperate: boolean;
  /** 是否当前回合(用于「回合」徽章) */
  isPerspectiveTurn: boolean;
  /** 已注册的技能前端 actions(技能按钮 + 装备技能按钮) */
  skillActions: SkillActionDef[];
  /** 点击技能按钮(武将技/装备技统一入口) */
  onSkillAction: (action: SkillActionDef) => void;
}

/** 技能按钮样式变体 → className 后缀 */
function skillBtnVariant(style: string | undefined): string {
  if (style === 'danger') return styles.skillBtnDanger;
  if (style === 'primary') return styles.skillBtnPrimary;
  return '';
}

export function PlayerCardLargeImpl({
  perspectiveIdx,
  viewer,
  view,
  damageFlashIndices,
  canOperate,
  isPerspectiveTurn,
  skillActions,
  onSkillAction,
}: PlayerCardLargeProps) {
  useSkillDescReady(); // 技能模块加载后重渲染,确保 title 中 getSkillDescription 命中
  const p = view.players[perspectiveIdx];
  if (!p) return null;

  const isDead = !p.alive;
  const charInfo = p.character ? getCharacterMeta(p.character) : undefined;
  const faction = charInfo?.faction ?? '群';
  const factionColor = FACTION_BG[faction] || '#8e44ad';
  const identity = p.identity;
  // 技能列表(过滤默认技能与装备技能)
  const visibleSkills = p.skills.filter(
    (s) => !DEFAULT_SKILLS.has(s) && !EQUIPMENT_SKILL_NAMES.has(s),
  );
  // 主动技(confirm/choosePlayer/转化类/distribute)渲染为可点按钮
  const triggerableActions = skillActions.filter(
    (a) =>
      a.prompt.type === 'confirm' ||
      a.prompt.type === 'choosePlayer' ||
      (a.prompt.type === 'useCardAndTarget' && !!a.transform) ||
      a.prompt.type === 'distribute',
  );
  // 技能按钮显隐:由 action 声明的 activeWhen 决定(缺省=出牌阶段+自己回合+无 pending)。
  // canOperate(debug 可操作性开关)作为外层闸门;激活时机不再硬编码在组件里。
  const actionCtx = { view, perspectiveIdx };
  const isSkillActive = (a: SkillActionDef) => canOperate && isActiveAction(a, actionCtx);
  const identityBadgeClass =
    identity === '主公'
      ? styles.lordBadge
      : identity === '忠臣'
        ? styles.loyalistBadge
        : identity === '反贼'
          ? styles.rebelBadge
          : identity === '内奸'
            ? styles.renegadeBadge
            : '';

  return (
    <>
      {/* 势力色顶部条 */}
      <div
        className={styles.playerCardHeader}
        style={{ '--faction-color': factionColor } as React.CSSProperties}
        data-player-name={p.name}
      >
        <div className={styles.playerCardHeaderTop}>
          <span className={styles.playerCardName}>{p.name}</span>
          <div>
            {perspectiveIdx === viewer && <span className={styles.youBadge}>我</span>}
            {isPerspectiveTurn && <span className={styles.turnBadge}>回合</span>}
            {isDead && <span className={cx(styles.youBadge, styles.deadBadge)}>亡</span>}
            {identity && <span className={identityBadgeClass}>{identity}</span>}
          </div>
        </div>
        <div className={styles.playerCardChar}>{p.character || '未知'}</div>
      </div>
      {/* 体力红心 */}
      <div className={styles.seatHpRow}>
        {Array.from({ length: p.maxHealth }, (_, i) => (
          <span
            key={i}
            className={cx(
              i < p.health ? styles.hpHeartFull : styles.hpHeartEmpty,
              damageFlashIndices.has(perspectiveIdx) && styles.hpFlash,
            )}
          >
            ♥
          </span>
        ))}
      </div>
      {/* 技能区:被动为标签,可主动点击的为按钮 */}
      {visibleSkills.length > 0 && (
        <div className={cx(styles.skillRow, styles.skillRowPad)}>
          {visibleSkills.map((s) => {
            const btn = triggerableActions.find((a) => a.skillId === s);
            const desc = getSkillDescription(s) ?? btn?.prompt.title;
            if (btn && isSkillActive(btn)) {
              return (
                <SkillTag
                  key={s}
                  as="button"
                  name={s}
                  description={desc}
                  className={cx(styles.skillBtn, skillBtnVariant(btn.style))}
                  onClick={() => onSkillAction(btn)}
                />
              );
            }
            return (
              <SkillTag
                key={s}
                name={s}
                description={desc}
                className={styles.skillTag}
              />
            );
          })}
        </div>
      )}
      {/* 判定区 */}
      {(p.pendingTricks?.length ?? 0) > 0 && (
        <div className={cx(styles.judgeRow, styles.judgeRowPad)}>
          <span className={styles.judgeRowLabel}>判定:</span>
          {(p.pendingTricks ?? []).map((cardId: string) => {
            const card = view.cardMap[cardId];
            const suitColor = SUIT_COLOR[card?.suit ?? '♠'] ?? '#ccc';
            return (
              <span
                key={cardId}
                className={styles.judgeTag}
                style={{ '--suit-color': suitColor } as React.CSSProperties}
                title={card?.description ?? card?.name ?? cardId}
              >
                {card?.name ?? cardId}
                {card ? ` ${card.suit}${card.rank}` : ''}
              </span>
            );
          })}
        </div>
      )}
      {/* 手牌数 */}
      <div className={styles.infoRow}>
        <span>手牌: {p.handCount}</span>
      </div>
    </>
  );
}

/** memo: 角色大卡只在玩家可见字段/技能可用性/动画/操作权限变化时重渲染 */
function playerCardLargePropsEqual(
  prev: PlayerCardLargeProps,
  next: PlayerCardLargeProps,
): boolean {
  const prevP = prev.view.players[prev.perspectiveIdx];
  const nextP = next.view.players[next.perspectiveIdx];
  if (!prevP || !nextP) return prevP === nextP;
  return (
    prev.perspectiveIdx === next.perspectiveIdx &&
    prev.viewer === next.viewer &&
    prev.canOperate === next.canOperate &&
    prev.isPerspectiveTurn === next.isPerspectiveTurn &&
    prev.damageFlashIndices.has(prev.perspectiveIdx) ===
      next.damageFlashIndices.has(next.perspectiveIdx) &&
    prev.onSkillAction === next.onSkillAction &&
    // skillActions:引用比较(useSkillActions 已 useMemo)
    prev.skillActions === next.skillActions &&
    // 玩家可见字段
    playerVisibleEqual(prevP, nextP) &&
    // 技能可用性依赖 phase + turn vars
    prev.view.phase === next.view.phase
  );
}

export const PlayerCardLarge = memo(PlayerCardLargeImpl, playerCardLargePropsEqual);
