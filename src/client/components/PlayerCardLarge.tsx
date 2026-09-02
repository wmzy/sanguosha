// src/client/components/PlayerCardLarge.tsx
// 视角玩家角色大卡(底栏右下,官方 OL 竖版武将卡形态):
// 立绘填满 + 左缘竖带(身份章/竖排武将名/体力数字)+ 右缘骑边体力珠列 +
// 底部紧凑技能按钮排(判定/手牌角标随排)。DOM 位置仍在 bottomLayout 内 stretch。
// 从 GameView.tsx 抽出的纯展示组件——内部无状态,所有数据/回调由父组件传入。
// 共享数据(view/perspectiveIdx/canOperate/skillActions)来自 GameViewCtx,专属数据仍走
// props。为保留 memo comparator 采用「context 消费壳 + 内部 memo impl」模式。
import { memo } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import { isActiveAction, isFreePlayWindow } from '../utils/gameViewHelpers';
import { FACTION_BG, SUIT_COLOR, EQUIPMENT_SKILL_NAMES } from './gameViewConstants';
import { getCharacterMeta, LORD_SKILLS } from '../../engine/data/character-meta';
import { getCharacterImage } from '../assets/imageAssets';
import { getSkillDescription } from '../../engine/skills/lifecycle';
import { useSkillDescReady } from '../hooks/useSkillDescReady';
import type { HpChangeNumber } from '../hooks/useAnimationState';
import { SkillTag } from './SkillTooltip';
import { DEFAULT_SKILLS as ENGINE_DEFAULT_SKILLS } from '../../engine/atoms/选将';
import { playerVisibleEqual } from '../utils/memo';
import { displaySkillName } from '../utils/skillDisplay';
import { useGameView } from './GameViewCtx';

const DEFAULT_SKILLS = new Set(ENGINE_DEFAULT_SKILLS);

export interface PlayerCardLargeProps {
  /** viewer 座次(用于显示「我」徽章) */
  viewer: number;
  /** 动画状态(体力闪烁) */
  damageFlashIndices: Map<number, number>;
  /** 回血动画状态(绿色闪烁) */
  healFlashIndices: Map<number, number>;
  /** 刚发生的体力变化(伤害 -N 红 / 回血 +N 绿 漂浮数字,动画期间存在) */
  hpChange?: HpChangeNumber;
  /** 是否当前回合(用于「回合」徽章) */
  isPerspectiveTurn: boolean;
  /** 点击技能按钮(武将技/装备技统一入口) */
  onSkillAction: (action: SkillActionDef) => void;
}

/** 内部 memo impl 的 props(含从 context 转发下来的共享字段)。 */
interface PlayerCardLargeImplProps extends PlayerCardLargeProps {
  /** 视角玩家在 view.players 中的下标 */
  perspectiveIdx: number;
  /** 引擎视图(取 players[perspectiveIdx] / cardMap / phase) */
  view: GameView;
  /** 是否可操作(debug 模式恒 true) */
  canOperate: boolean;
  /** 已注册的技能前端 actions(技能按钮 + 装备技能按钮) */
  skillActions: SkillActionDef[];
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
  healFlashIndices,
  hpChange,
  canOperate,
  isPerspectiveTurn,
  skillActions,
  onSkillAction,
}: PlayerCardLargeImplProps) {
  useSkillDescReady(); // 技能模块加载后重渲染,确保 title 中 getSkillDescription 命中
  const p = view.players[perspectiveIdx];
  if (!p) return null;

  const isDead = !p.alive;
  // 横置(铁索连环):marks 含 'chained' —— 大卡给出铁链光泽 + 连环徽章
  const isChained = p.marks.some((m) => m.id === 'chained');
  const charInfo = p.character ? getCharacterMeta(p.character) : undefined;
  const faction = charInfo?.faction ?? '群';
  const factionColor = FACTION_BG[faction] || '#8e44ad';
  const charImg = p.character ? getCharacterImage(p.character) : null;
  const identity = p.identity;
  const isLordSeat = identity === '主公';
  // 技能列表(过滤默认技能与装备技能;非主公隐藏主公技)
  const visibleSkills = p.skills.filter(
    (s) =>
      !DEFAULT_SKILLS.has(s) &&
      !EQUIPMENT_SKILL_NAMES.has(s) &&
      (isLordSeat || !LORD_SKILLS.has(s)),
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
  // 「原则上可操作」场景:自由出牌窗口(自己回合+出牌阶段+无阻塞 pending),与
  // defaultPlayActive 缺省条件集一致。该窗口内 btn 存在但不激活(限一次已用/activeWhen
  // 不满足)→ 渲染置灰禁用按钮而非被动标签,让玩家能区分「已用/条件不满足」与「技能不存在」;
  // 其余场景(别人回合等)维持被动标签。
  const inFreePlayWindow =
    canOperate &&
    isFreePlayWindow({
      isMyTurn: isPerspectiveTurn,
      phase: view.phase,
      pending: view.pending,
    });
  // 体力珠缩放:整列布局高度 = 17N−3(N=maxHealth),卡高 200px,仅 N ≥ 12(17×12−3=201>200)
  // 才会溢出卡面,此时按 6/maxHealth 等比缩小珠体与间距(与座位卡 PlayerSeatView 同规则);
  // N ≤ 11 沿用基础尺寸(标准 4 血场景无回归)。
  const hpScale = p.maxHealth >= 12 ? 6 / p.maxHealth : 1;
  const beadW = `${10 * hpScale}px`;
  const beadH = `${14 * hpScale}px`;
  const hpGap = `${3 * hpScale}px`;
  // 珠列方向与分色(与座位卡 PlayerSeatView 同规则):损失的体力(空珠)在上方,
  // 剩余体力(满珠)在下方;满珠颜色按剩余比例分色:>50% 绿 / >25% 黄 / ≤25% 红(濒危警示)。
  const lostCount = Math.max(0, p.maxHealth - p.health);
  const hpRatio = p.maxHealth > 0 ? p.health / p.maxHealth : 1;
  const hpBeadFullCls =
    hpRatio > 0.5
      ? styles.playerCardHpBeadFull
      : hpRatio > 0.25
        ? styles.playerCardHpBeadFullMid
        : styles.playerCardHpBeadFullLow;
  // 身份小方章(左缘竖带顶部):主公金/忠臣蓝/反贼红/内奸紫
  const identityBadgeClass =
    identity === '主公'
      ? styles.playerCardStampLord
      : identity === '忠臣'
        ? styles.playerCardStampLoyalist
        : identity === '反贼'
          ? styles.playerCardStampRebel
          : identity === '内奸'
            ? styles.playerCardStampRenegade
            : '';

  return (
    <>
      {/* 武将立绘:填满大卡(自身圆角裁剪);无素材/404 时回退势力色背景 */}
      <div
        className={styles.playerCardPortrait}
        style={{ '--faction-color': factionColor } as React.CSSProperties}
        aria-hidden
      >
        {charImg && (
          <img
            className={cx(styles.playerCardPortraitImg, isDead && styles.playerCardPortraitDead)}
            src={charImg}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
      </div>
      {/* 右缘体力珠列:垂直排列,骑在卡右边框上;空珠(已损失)在上,满珠在下按余量分色 */}
      <div className={styles.playerCardHpBeadCol} style={{ gap: hpGap }} aria-hidden data-hp-beads>
        {Array.from({ length: p.maxHealth }, (_, i) => (
          <span
            key={i}
            className={i < lostCount ? styles.playerCardHpBeadEmpty : hpBeadFullCls}
            data-full={i < lostCount ? undefined : 'true'}
            data-hue={i < lostCount ? undefined : hpRatio > 0.5 ? 'green' : hpRatio > 0.25 ? 'yellow' : 'red'}
            style={{ width: beadW, height: beadH }}
          />
        ))}
      </div>
      {/* 文字内容层:名牌横条(上) + 左缘竖带 + 底部紧凑技能排;中部透出立绘 */}
      <div className={cx(styles.playerCardContent, isChained && styles.playerCardChained)}>
      {/* 体力变化漂浮数字:伤害「-N」红 / 回血「+N」绿,上浮渐隐(动画状态由 useAnimationState 定时清除) */}
      {hpChange && (
        <span
          key={`hpnum-${hpChange.version}`}
          className={cx(
            styles.hpFloatNumber,
            hpChange.kind === 'heal' ? styles.hpFloatHeal : styles.hpFloatDamage,
          )}
          aria-hidden
        >
          {hpChange.kind === 'heal' ? `+${hpChange.amount}` : `-${hpChange.amount}`}
        </span>
      )}
      {/* 名牌横条(卡顶):玩家名 + 徽章组(我/回合/⛓) */}
      <div
        className={styles.playerCardHeader}
        style={{ '--faction-color': factionColor } as React.CSSProperties}
        data-player-name={p.name}
      >
        <div className={styles.playerCardHeaderTop}>
          <span className={styles.playerCardName}>{p.name}</span>
          <div className={styles.playerCardBadges}>
            {perspectiveIdx === viewer && <span className={styles.playerCardBadgeYou}>我</span>}
            {isPerspectiveTurn && <span className={styles.playerCardBadgeTurn}>回合</span>}
            {isChained && (
              <span className={styles.playerCardBadgeChain} title="横置·铁索连环">
                ⛓
              </span>
            )}
          </div>
        </div>
      </div>
      {/* 卡内左缘竖带:身份章 + 竖排武将名 + 体力数字 */}
      <div className={styles.playerCardSideBand}>
        {identity && (
          <span className={cx(styles.playerCardStampBase, identityBadgeClass)}>{identity}</span>
        )}
        <span className={styles.playerCardChar}>{p.character || '未知'}</span>
        <span
          className={cx(
            styles.playerCardHpNumber,
            damageFlashIndices.has(perspectiveIdx) && styles.hpFlash,
            healFlashIndices.has(perspectiveIdx) && styles.hpHealFlash,
          )}
        >
          {p.health}
        </span>
      </div>
      {/* 死亡「亡」印章:旋转红字大印(立绘同时 grayscale) */}
      {isDead && (
        <span className={styles.playerCardDeadStamp} aria-hidden>
          亡
        </span>
      )}
      {/* 卡底部紧凑区:技能按钮排 + 判定行 + 手牌角标(官方为暗色小牌叠放) */}
      <div className={styles.playerCardBottom}>
      {/* 技能区:被动为标签,可主动点击的为按钮 */}
      {visibleSkills.length > 0 && (
        <div className={styles.playerCardSkillRow}>
          {visibleSkills.map((s) => {
            const btn = triggerableActions.find((a) => a.skillId === s);
            // 描述/资源按原 id(s)查询;展示名去前导"界"
            const desc = getSkillDescription(s) ?? btn?.prompt.title;
            const display = displaySkillName(s);
            if (btn && isSkillActive(btn)) {
              return (
                <SkillTag
                  key={s}
                  as="button"
                  name={display}
                  description={desc}
                  className={cx(styles.skillBtn, skillBtnVariant(btn.style))}
                  onClick={() => onSkillAction(btn)}
                />
              );
            }
            if (btn && inFreePlayWindow) {
              return (
                <SkillTag
                  key={s}
                  as="button"
                  name={display}
                  description={desc}
                  className={cx(styles.skillBtn, styles.skillBtnDisabled)}
                  disabled
                  title="当前不可发动（已发动或条件不满足）"
                />
              );
            }
            return (
              <SkillTag
                key={s}
                name={display}
                description={desc}
                className={styles.playerCardSkillTag}
              />
            );
          })}
        </div>
      )}
      {/* 判定区 */}
      {(p.pendingTricks?.length ?? 0) > 0 && (
        <div className={styles.playerCardJudgeRow}>
          <span className={styles.playerCardJudgeLabel}>判定:</span>
          {(p.pendingTricks ?? []).map((cardId: string) => {
            const card = view.cardMap[cardId];
            const suitColor = SUIT_COLOR[card?.suit ?? '♠'] ?? '#ccc';
            return (
              <span
                key={cardId}
                className={styles.playerCardJudgeTag}
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
      {/* 手牌数角标 */}
      <span className={styles.playerCardHandChip} title={`手牌: ${p.handCount}`}>
        🂠 {p.handCount}
      </span>
      </div>
      </div>
    </>
  );
}

/** memo: 角色大卡只在玩家可见字段/技能可用性/动画/操作权限变化时重渲染 */
function playerCardLargePropsEqual(
  prev: PlayerCardLargeImplProps,
  next: PlayerCardLargeImplProps,
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
    prev.healFlashIndices.has(prev.perspectiveIdx) ===
      next.healFlashIndices.has(next.perspectiveIdx) &&
    prev.hpChange?.kind === next.hpChange?.kind &&
    prev.hpChange?.amount === next.hpChange?.amount &&
    prev.hpChange?.version === next.hpChange?.version &&
    prev.onSkillAction === next.onSkillAction &&
    // skillActions:引用比较(useSkillActions 已 useMemo)
    prev.skillActions === next.skillActions &&
    // 玩家可见字段
    playerVisibleEqual(prevP, nextP) &&
    // 技能可用性依赖 phase + turn vars
    prev.view.phase === next.view.phase &&
    // 以及阻塞型 pending 的有无(自由出牌窗口开合,驱动按钮↔标签/置灰切换)
    hasBlockingPending(prev.view.pending) === hasBlockingPending(next.view.pending)
  );
}

/** view 根 pending 是否为阻塞型(与 isFreePlayWindow/defaultPlayActive 同源的判定)。 */
function hasBlockingPending(pending: GameView['pending']): boolean {
  return pending != null && pending.isBlocking !== false;
}

const PlayerCardLargeMemo = memo(PlayerCardLargeImpl, playerCardLargePropsEqual);

/** context 消费壳:共享数据(view/perspectiveIdx/canOperate/skillActions)来自
 *  GameViewCtx,转发给保持原 comparator 的 memo impl。 */
export function PlayerCardLarge(props: PlayerCardLargeProps) {
  const { view, perspectiveIdx, canOperate, skillActions } = useGameView();
  return (
    <PlayerCardLargeMemo
      {...props}
      perspectiveIdx={perspectiveIdx}
      view={view}
      canOperate={canOperate}
      skillActions={skillActions}
    />
  );
}
