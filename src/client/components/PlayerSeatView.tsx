// src/client/components/PlayerSeatView.tsx
// 玩家座位视图(弧形座位上的每张武将卡) — 从 GameView.tsx 抽出。
// 结构对齐官方 OL 客户端:卡上方名牌(身份章+玩家名+徽章组) + 竖版立绘卡本体
// (卡内左缘竖带:势力章/竖排武将名/体力数字;右缘骑边体力珠列;右下手牌角标;
// 死亡「亡」印章) + 卡下小标签行(装备/判定/技能/标记)。
// 样式已迁至 gameViewStyles/seat.ts(座位卡段);本文件只留组件逻辑。
// 视觉派生(势力/立绘/身份章)与体力漂浮数字为座位卡/大卡/选将遮罩共享,
// 见 utils/characterVisuals 与 utils/HpFloatNumber。
import { memo } from 'react';
import { cx } from '@linaria/core';
import type { EquipSlot, GameView } from '../../engine/types';
import { shallowArrayEqual, playerVisibleEqual } from '../utils/memo';
import type { SkillActionDef } from '../skillActionRegistry';
import { getSkillDescription } from '../../engine/skills/lifecycle';
import { useSkillDescReady } from '../hooks/useSkillDescReady';
import type { HpChangeNumber } from '../hooks/useAnimationState';
import { SkillTag } from './SkillTooltip';
import { SUIT_COLOR, EQUIPMENT_SKILL_NAMES, EQUIP_SLOT_ICON } from './gameViewConstants';
import * as styles from './gameViewStyles';
import { HpBeadColumn } from './HpBeadColumn';
import { LORD_SKILLS } from '../../engine/data/character-meta';
import { DEFAULT_SKILLS as ENGINE_DEFAULT_SKILLS } from '../../engine/atoms/选将';
import { displaySkillName, groupDisplayMarks } from '../utils/skillDisplay';
import {
  getCharacterCardVisuals,
  hideImgOnError,
  identityStampClass,
} from '../utils/characterVisuals';
import { HpFloatNumber } from '../utils/HpFloatNumber';

const DEFAULT_SKILLS = new Set(ENGINE_DEFAULT_SKILLS);

export interface PlayerSeatProps {
  player: GameView['players'][number];
  index: number;
  view: GameView;
  isCurrentPlayer: boolean;
  isPerspective: boolean;
  needsTarget: boolean;
  isTargetable: boolean;
  /** 已选中的目标 name 集合(借刀杀人等双目标会含 A+B) */
  selectedTargetNames: string[];
  onTargetClick: (name: string) => void;
  /** 双击座次卡片(通用 UI 事件;上层决定具体行为,如切换视角)。 */
  onSeatDoubleClick?: (index: number) => void;
  /** 该玩家是否刚受到伤害 */
  isDamaged?: boolean;
  /** 伤害动画版本号(每次伤害递增,触发 key 变化重放动画) */
  damageVersion?: number;
  /** 该玩家是否刚回复体力(桃/桃园结义/急救) */
  isHealed?: boolean;
  /** 回血动画版本号(每次回血递增,触发 key 变化重放动画) */
  healVersion?: number;
  /** 该玩家刚发生的体力变化(伤害 -N 红 / 回血 +N 绿 漂浮数字,动画期间存在) */
  hpChange?: HpChangeNumber;
  /** 是否触发新回合光环 */
  isTurnGlow?: boolean;
  turnGlowVersion?: number;
  /** debug 模式:是否在前端隐藏身份(非视角/非主公/非死亡) */
  hideIdentity?: boolean;
  /** 视角玩家可主动发动的技能动作列表(预留,目前仅接受不渲染) */
  skillActions?: SkillActionDef[];
  /** 该座次对应玩家已断线(重连宽限期内),座位卡显示离线角标并置灰 */
  isDisconnected?: boolean;
  /** 选目标阶段:到我的实际距离(含马修正),非 null 时在座位卡上显示「距N」角标 */
  seatDistance?: number | null;
  /** 选目标阶段:该座次不可选的原因(hover title,如「距离 3，超出攻击范围 1」) */
  untargetableReason?: string | null;
}

/** 卡上方名牌:横向暗条(宽=卡宽)。左:身份小方章 + 座号 + 玩家名,右:徽章组(我/回合/⛓/离线)。 */
interface SeatNamePlateProps {
  player: PlayerSeatProps['player'];
  index: number;
  /** 身份是否展示(父组件按 hideIdentity/视角/主公/死亡 汇总算好) */
  showIdentity: boolean;
  isCurrentPlayer: boolean;
  isPerspective: boolean;
  isChained: boolean;
  isDisconnected: boolean;
}

function SeatNamePlate({
  player,
  index,
  showIdentity,
  isCurrentPlayer,
  isPerspective,
  isChained,
  isDisconnected,
}: SeatNamePlateProps) {
  const identity = player.identity;
  return (
    <div className={cx(styles.seatNamePlate, isCurrentPlayer && styles.seatNamePlateActive)}>
      {showIdentity && identity ? (
        <span
          className={cx(
            styles.seatIdentityStamp,
            identityStampClass(identity, {
              lord: styles.seatIdentityLord,
              loyalist: styles.seatIdentityLoyalist,
              rebel: styles.seatIdentityRebel,
              renegade: styles.seatIdentityRenegade,
              hidden: styles.seatIdentityHidden,
            }),
          )}
        >
          {identity}
        </span>
      ) : (
        !showIdentity &&
        player.identityHidden !== false && <span className={cx(styles.seatIdentityStamp, styles.seatIdentityHidden)}>暗</span>
      )}
      <span className={styles.seatIndexBadge}>#{index + 1}</span>
      <span className={styles.seatName}>{player.name.slice(0, 6)}</span>
      <div className={styles.seatBadgeGroup}>
        {isPerspective && <span className={styles.youBadge}>我</span>}
        {isCurrentPlayer && <span className={styles.turnBadge}>回合</span>}
        {isChained && (
          <span className={styles.chainBadge} title="横置·铁索连环">
            ⛓
          </span>
        )}
        {isDisconnected && (
          <span className={styles.offlineBadge} title="该玩家已断线,等待重连">
            离线
          </span>
        )}
      </div>
    </div>
  );
}

/** 竖版立绘卡本体:包裹层(体力珠列/漂浮数字锚点) + 卡面(立绘/左缘竖带/角标/死亡印章) + 状态类。 */
interface SeatCardBodyProps {
  player: PlayerSeatProps['player'];
  displayChar: PlayerSeatProps['player']['character'];
  charImg: string | null;
  faction: string;
  factionColor: string;
  isCurrentPlayer: boolean;
  isPerspective: boolean;
  isDead: boolean;
  isClickable: boolean;
  isChained: boolean;
  /** 该座次已被选为目标(selectedTargetNames 命中) */
  isTargeted: boolean;
  isTurnGlow: boolean;
  isDamaged: boolean;
  isHealed: boolean;
  needsTarget: boolean;
  seatDistance: number | null;
  untargetableReason: string | null;
  hpChange?: HpChangeNumber;
}

function SeatCardBody({
  player,
  displayChar,
  charImg,
  faction,
  factionColor,
  isCurrentPlayer,
  isPerspective,
  isDead,
  isClickable,
  isChained,
  isTargeted,
  isTurnGlow,
  isDamaged,
  isHealed,
  needsTarget,
  seatDistance,
  untargetableReason,
  hpChange,
}: SeatCardBodyProps) {
  return (
    // 卡本体包裹层:relative 锚点,承载骑右边的体力珠列与漂浮数字(不被卡本体 overflow 裁剪)
    <div
      className={cx(
        styles.seatCardWrap,
        isDamaged && styles.seatCardDamageOverlay,
        isHealed && styles.seatCardHealOverlay,
      )}
    >
      {/* 卡本体:竖版立绘填满 + 细金铜描边 + 外圈深色,状态类全部挂在此层 */}
      <div
        className={cx(
          styles.seatCard,
          isCurrentPlayer && styles.seatCardActive,
          isPerspective && styles.seatCardPerspective,
          isDead && styles.seatCardDead,
          isClickable && styles.seatCardTargetable,
          isChained && styles.seatCardChained,
          isTargeted && styles.seatCardTargetPulse,
          isTurnGlow && styles.turnGlowing,
        )}
      >
        {/* 武将立绘:object-fit cover 填满卡面;无素材/404 时回退势力色背景 */}
        <div className={cx(styles.seatCharImgWrap, !charImg && styles.seatCharImgWrapEmpty, isChained && styles.seatCharImgChained)} aria-hidden>
          {charImg && (
            <img
              className={cx(styles.seatCharImg, isDead && styles.seatCharImgDead)}
              src={charImg}
              alt=""
              loading="lazy"
              decoding="async"
              onError={hideImgOnError}
            />
          )}
        </div>
        {/* 卡内左缘竖带:顶部势力印章 + 中间竖排武将名 + 底部体力数字 */}
        <div className={styles.seatSideBand}>
          <span className={styles.seatFactionStamp} style={{ background: factionColor }}>
            {faction}
          </span>
          <span className={styles.seatCharName}>{displayChar || '未知'}</span>
          <span className={cx(styles.seatHpNumber, isDamaged && styles.hpFlash, isHealed && styles.hpHealFlash)}>
            {player.health}
          </span>
        </div>
        {/* 手牌数角标:卡内右下角小暗章(title 保留完整手牌信息) */}
        <span className={styles.seatHandBadge} title={`手牌: ${player.handCount}`}>
          🂠 {player.handCount}
        </span>
        {/* 选目标阶段距离角标:卡内左下角「距N」(仅 needsTarget 时上层传入) */}
        {needsTarget && seatDistance != null && (
          <span
            className={styles.seatDistanceBadge}
            title={`与你的距离: ${seatDistance}${untargetableReason ? `（${untargetableReason}）` : ''}`}
          >
            距 {seatDistance}
          </span>
        )}
        {/* 死亡印章:身份+阵亡 两行红字大印(立绘同时 grayscale),对齐官方「反贼/阵亡」印 */}
        {isDead && (
          <span className={styles.seatDeadStamp} aria-hidden>
            {player.identity ? (
              <>
                <i>{player.identity}</i>
                <i>阵亡</i>
              </>
            ) : (
              '亡'
            )}
          </span>
        )}
      </div>
      {/* 右缘体力珠列:垂直排列,骑在卡右边框上;空珠(已损失)在上,满珠在下按余量分色
          (缩放/分色的共享实现见 HpBeadColumn) */}
      <HpBeadColumn
        className={styles.seatHpBeadCol}
        maxHealth={player.maxHealth}
        health={player.health}
      />
      {/* 体力变化漂浮数字:伤害「-N」红 / 回血「+N」绿,上浮渐隐(动画状态由 useAnimationState 定时清除) */}
      {hpChange && <HpFloatNumber hpChange={hpChange} variant="seat" />}
    </div>
  );
}

/** 卡下小标签行:装备 / 判定 / 技能 chips / 标记(每行独立、紧凑)。 */
function SeatLabelRows({ player, view }: { player: PlayerSeatProps['player']; view: GameView }) {
  return (
    <div className={styles.seatLabelCol}>
      {/* 装备行:暗条 chip + 图标 + 牌名 + 花色点数 */}
      {Object.keys(player.equipment).length > 0 && (
        <div className={styles.equipRow}>
          {Object.entries(player.equipment).map(([slot, cardId]) => {
            const card = view.cardMap[cardId];
            const icon = EQUIP_SLOT_ICON[slot as EquipSlot] ?? '💎';
            const suitColor = SUIT_COLOR[card?.suit ?? '♠'] ?? '#ccc';
            return (
              <span
                key={slot}
                title={
                  card
                    ? `${card.name}（${slot}）${card.description ? `\n${card.description}` : ''}`
                    : String(cardId)
                }
              >
                {icon}
                {card?.name ?? cardId}
                {card && (
                  <span style={{ color: suitColor }}>
                    {card.rank}
                    {card.suit}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
      {/* 判定区(延时锦囊):紫边 chip */}
      {(() => {
        const ids = player.pendingTricks ?? [];
        if (ids.length === 0) return null;
        return (
          <div className={styles.judgeRow}>
            <span className={styles.judgeRowLabel}>判定:</span>
            {ids.map((cardId: string) => {
              const card = view.cardMap[cardId];
              const suitColor = SUIT_COLOR[card?.suit ?? '♠'] ?? '#ccc';
              const desc = card?.description ?? '';
              return (
                <span
                  key={cardId}
                  className={styles.judgeTag}
                  style={{ '--suit-color': suitColor } as React.CSSProperties}
                  title={desc || card?.name || cardId}
                >
                  {card?.name ?? cardId}
                  {card ? ` ${card.suit}${card.rank}` : ''}
                </span>
              );
            })}
          </div>
        );
      })()}
      {/* 技能 chips:暗底金字小圆角 */}
      {(() => {
        const isLordSeat = player.identity === '主公';
        const seatVisibleSkills = player.skills
          .filter((s) => !DEFAULT_SKILLS.has(s))
          .filter((s) => !EQUIPMENT_SKILL_NAMES.has(s))
          .filter((s) => isLordSeat || !LORD_SKILLS.has(s));
        if (seatVisibleSkills.length === 0) return null;
        return (
          <div className={styles.skillRow}>
            {seatVisibleSkills.map((s) => (
              // 描述按原 id(s)查询;展示名去前导"界"
              <SkillTag key={s} name={displaySkillName(s)} description={getSkillDescription(s)} className={styles.skillTag} />
            ))}
          </div>
        );
      })()}
      {/* 标记行:原始 id(`技能名/属性:N`)聚合为「属性 ×N」徽章,明细进 tooltip */}
      {(() => {
        const badges = groupDisplayMarks(player.marks);
        if (badges.length === 0) return null;
        return (
          <div className={styles.markRow}>
            {badges.map((b) => (
              <span key={b.key} className={styles.markTag} title={b.title}>
                {b.label}
              </span>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

function PlayerSeatViewImpl({
  player,
  index,
  view,
  isCurrentPlayer,
  isPerspective,
  needsTarget,
  isTargetable,
  selectedTargetNames = [],
  onTargetClick,
  onSeatDoubleClick,
  isDamaged = false,
  damageVersion = 0,
  isHealed = false,
  healVersion = 0,
  hpChange,
  isTurnGlow = false,
  turnGlowVersion = 0,
  hideIdentity = true,
  skillActions: _skillActions, // 预留:未来用于在座位卡上显示可点使用的技能按钮
  isDisconnected = false,
  seatDistance = null,
  untargetableReason = null,
}: PlayerSeatProps) {
  useSkillDescReady(); // 技能模块加载后重渲染,确保 title 中 getSkillDescription 命中
  void turnGlowVersion; // 预留:未来用于触发不同强度的回合光环动画
  const isDead = !player.alive;
  // 横置(铁索连环):marks 含 'chained' —— 卡边框铁链光泽 + 立绘冷色调 + 连环徽章
  const isChained = player.marks.some((m) => m.id === 'chained');
  const isClickable = needsTarget && !isDead && isTargetable;
  // 选目标阶段:不可选的活座位置灰(距离外/不满足槽位条件),与可选座位形成对比
  const isUntargetable = needsTarget && !isDead && !isTargetable;
  // 势力信息(与视角大卡/选将遮罩共享派生,见 utils/characterVisuals)
  const displayChar = player.character;
  const { faction, factionColor, charImg } = getCharacterCardVisuals(displayChar);

  // 身份(debug 模式非视角/非主公/未死亡时隐藏,显示「暗」章)
  const showIdentity =
    !!player.identity &&
    (!hideIdentity || isPerspective || player.identity === '主公' || !player.alive);

  return (
    <div
      className={cx(
        styles.seatRoot,
        isUntargetable && styles.seatCardUntargetable,
        isDisconnected && styles.seatCardDisconnected,
        isDamaged && styles.seatShaking,
      )}
      data-player-name={player.name}
      data-seat-index={index}
      key={damageVersion > 0 || healVersion > 0 ? `dmg-${damageVersion}-heal-${healVersion}` : undefined}
      style={{ '--faction-color': factionColor } as React.CSSProperties}
      onClick={() => isClickable && onTargetClick(player.name)}
      onDoubleClick={() => onSeatDoubleClick?.(index)}
      // 选目标阶段不可选时给出原因(原生 title):距离不足/不可选自己/阵亡等
      title={isUntargetable && untargetableReason ? `不可选择：${untargetableReason}` : undefined}
    >
      {/* 卡上方名牌:身份章 + 座号 + 玩家名 + 徽章组(我/回合/⛓/离线) */}
      <SeatNamePlate
        player={player}
        index={index}
        showIdentity={showIdentity}
        isCurrentPlayer={isCurrentPlayer}
        isPerspective={isPerspective}
        isChained={isChained}
        isDisconnected={isDisconnected}
      />
      {/* 竖版立绘卡本体 + 右缘体力珠列 + 漂浮数字 */}
      <SeatCardBody
        player={player}
        displayChar={displayChar}
        charImg={charImg}
        faction={faction}
        factionColor={factionColor}
        isCurrentPlayer={isCurrentPlayer}
        isPerspective={isPerspective}
        isDead={isDead}
        isClickable={isClickable}
        isChained={isChained}
        isTargeted={selectedTargetNames.includes(player.name)}
        isTurnGlow={isTurnGlow}
        isDamaged={isDamaged}
        isHealed={isHealed}
        needsTarget={needsTarget}
        seatDistance={seatDistance}
        untargetableReason={untargetableReason}
        hpChange={hpChange}
      />
      {/* 卡下小标签行:装备 / 判定 / 技能 chips / 标记 */}
      <SeatLabelRows player={player} view={view} />
    </div>
  );
}
/**
 * React.memo 自定义比较器:
 * WebSocket view 更新会创建全新的 view/player 对象引用,默认浅比较无法拦截。
 * 本比较器逐字段检查影响渲染的 primitive props + player 可见字段,
 * cardMap 查找(cardId → 不可变 Card)无需比较——cardId 不变则卡片显示不变。
 * 函数 props(onTargetClick/onSeatDoubleClick)依赖父组件 useCallback 保持稳定引用。
 */
function playerSeatPropsEqual(prev: PlayerSeatProps, next: PlayerSeatProps): boolean {
  return (
    // primitive props
    prev.index === next.index &&
    prev.isCurrentPlayer === next.isCurrentPlayer &&
    prev.isPerspective === next.isPerspective &&
    prev.needsTarget === next.needsTarget &&
    prev.isTargetable === next.isTargetable &&
    prev.isDamaged === next.isDamaged &&
    prev.damageVersion === next.damageVersion &&
    prev.isHealed === next.isHealed &&
    prev.healVersion === next.healVersion &&
    prev.hpChange?.kind === next.hpChange?.kind &&
    prev.hpChange?.amount === next.hpChange?.amount &&
    prev.hpChange?.version === next.hpChange?.version &&
    prev.isTurnGlow === next.isTurnGlow &&
    prev.turnGlowVersion === next.turnGlowVersion &&
    prev.hideIdentity === next.hideIdentity &&
    prev.isDisconnected === next.isDisconnected &&
    prev.seatDistance === next.seatDistance &&
    prev.untargetableReason === next.untargetableReason &&
    // 函数 props（引用相等，依赖父组件 useCallback）
    prev.onTargetClick === next.onTargetClick &&
    prev.onSeatDoubleClick === next.onSeatDoubleClick &&
    // selectedTargetNames: string[]
    shallowArrayEqual(prev.selectedTargetNames ?? [], next.selectedTargetNames ?? []) &&
    // player 可见字段（view.cardMap 查找确定性，无需比较 view）
    playerVisibleEqual(prev.player, next.player)
  );
}

export const PlayerSeatView = memo(PlayerSeatViewImpl, playerSeatPropsEqual);
