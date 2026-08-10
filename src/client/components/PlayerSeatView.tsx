// src/client/components/PlayerSeatView.tsx
// 玩家座位视图(弧形座位上的每张武将卡) — 从 GameView.tsx 抽出
import { memo } from 'react';
import { css, cx } from '@linaria/core';
import type { EquipSlot, GameView } from '../../engine/types';
import { shallowArrayEqual, playerVisibleEqual } from '../utils/memo';
import type { SkillActionDef } from '../skillActionRegistry';
import { getSkillDescription } from '../../engine/skills/lifecycle';
import { useSkillDescReady } from '../hooks/useSkillDescReady';
import { SkillTag } from './SkillTooltip';
import {
  FACTION_BG,
  SUIT_COLOR,
  EQUIPMENT_SKILL_NAMES,
  EQUIP_SLOT_ICON,
} from './gameViewConstants';
import { getCharacterMeta, LORD_SKILLS } from '../../engine/data/character-meta';
import { getCharacterImage } from '../assets/imageAssets';
import { DEFAULT_SKILLS as ENGINE_DEFAULT_SKILLS } from '../../engine/atoms/选将';
import { displaySkillName } from '../utils/skillDisplay';

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
  /** 是否触发新回合光环 */
  isTurnGlow?: boolean;
  turnGlowVersion?: number;
  /** debug 模式:是否在前端隐藏身份(非视角/非主公/非死亡) */
  hideIdentity?: boolean;
  /** 视角玩家可主动发动的技能动作列表(预留,目前仅接受不渲染) */
  skillActions?: SkillActionDef[];
  /** 该座次对应玩家已断线(重连宽限期内),座位卡显示离线角标并置灰 */
  isDisconnected?: boolean;
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
  isTurnGlow = false,
  turnGlowVersion = 0,
  hideIdentity = true,
  skillActions: _skillActions, // 预留:未来用于在座位卡上显示可点使用的技能按钮
  isDisconnected = false,
}: PlayerSeatProps) {
  useSkillDescReady(); // 技能模块加载后重渲染,确保 title 中 getSkillDescription 命中
  void turnGlowVersion; // 预留:未来用于触发不同强度的回合光环动画
  const isDead = !player.alive;
  // 横置(铁索连环):marks 含 'chained' —— 座位卡给出铁链光泽 + 连环徽章,代表武将牌横置状态
  const isChained = player.marks.some((m) => m.id === 'chained');
  const isClickable = needsTarget && !isDead && isTargetable;
  // 选目标阶段:不可选的活座位置灰(距离外/不满足槽位条件),与可选座位形成对比
  const isUntargetable = needsTarget && !isDead && !isTargetable;
  // 势力信息
  const displayChar = player.character;
  const charInfo = displayChar ? getCharacterMeta(displayChar) : undefined;
  const faction = charInfo?.faction ?? '群';
  const factionColor = FACTION_BG[faction] ?? '#8e44ad';
  const charImg = displayChar ? getCharacterImage(displayChar) : null;
  // onerror 时清除 src 隐藏 <img>,让卡牌保留文字回退;
  // 避免每张座位卡挂独立的 state hook(座次很多,会拖慢重渲染)
  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none';
  };

  // 身份
  const identity = player.identity;
  const showIdentity =
    identity && (!hideIdentity || isPerspective || identity === '主公' || !player.alive);

  // 体力红心动态缩放:♥ 字形进宽约 1em,座位内容宽度约 136px
  // (--hero-card-h 200px × 15/19 − 卡边框 − 行 padding 20px)。基础尺寸(满血 16px /
  // 空血 14px / 间距 2px)下 maxHealth ≥ 7 即 18N−2 会超出该宽度而被截断/溢出。
  // 故 maxHealth ≥ 7 时按 6/maxHealth 等比缩小满血与空血字号及间距(两者同步缩放保持对齐),
  // 使任意 maxHealth 的所有心完整排列在座位内;≤ 6 沿用原值(标准 4 血场景无回归)。
  const hpScale = player.maxHealth >= 7 ? 6 / player.maxHealth : 1;
  const hpFullSize = `${16 * hpScale}px`;
  const hpEmptySize = `${14 * hpScale}px`;
  const hpGap = `${2 * hpScale}px`;

  return (
    <div
      className={cx(
        seatCard,
        isCurrentPlayer && seatCardActive,
        isPerspective && seatCardPerspective,
        isDead && seatCardDead,
        isClickable && seatCardClickable,
        isUntargetable && seatCardUntargetable,
        selectedTargetNames.includes(player.name) && seatCardTargeted,
        isDamaged && seatShaking,
        isDamaged && seatDamageOverlay,
        isHealed && seatHealOverlay,
        isTurnGlow && turnGlowing,
        isChained && seatCardChained,
        isDisconnected && seatCardDisconnected,
      )}
      data-player-name={player.name}
      data-seat-index={index}
      key={damageVersion > 0 || healVersion > 0 ? `dmg-${damageVersion}-heal-${healVersion}` : undefined}
      style={{ '--faction-color': factionColor } as React.CSSProperties}
      onClick={() => isClickable && onTargetClick(player.name)}
      onDoubleClick={() => onSeatDoubleClick?.(index)}
    >
      {/* 武将立绘作座位卡背景:始终渲染一层势力色,无素材/404 时回退势力色背景 */}
      <div className={seatCharImgWrap} aria-hidden>
        {charImg && (
          <img
            className={cx(seatCharImg, isDead && seatCharImgDead)}
            src={charImg}
            alt=""
            loading="lazy"
            decoding="async"
            onError={handleImgError}
          />
        )}
      </div>
      {/* 内容层:浮在立绘上,底部渐变蒙版保证文字可读 */}
      <div className={seatCardContent}>
      {/* 势力色顶部条:武将名 + 座号 + 身份(--faction-color 由根节点注入) */}
      <div className={seatCardHeader}>
        <div className={seatCardHeaderTop}>
          <span className={seatIndexBadge}>#{index + 1}</span>
          <span className={seatName}>{player.name.slice(0, 6)}</span>
          <div>
            {isPerspective && <span className={youBadge}>我</span>}
            {isCurrentPlayer && <span className={turnBadge}>回合</span>}
            {isChained && (
              <span className={chainBadge} title="横置·铁索连环">
                ⛓
              </span>
            )}
            {isDisconnected && <span className={offlineBadge} title="该玩家已断线,等待重连">离线</span>}
            {isDead && <span className={deadBadgeText}>亡</span>}
            {showIdentity && identity && (
              <span
                className={
                  identity === '主公'
                    ? lordBadge
                    : identity === '忠臣'
                      ? loyalistBadge
                      : identity === '反贼'
                        ? rebelBadge
                        : identity === '内奸'
                          ? renegadeBadge
                          : ''
                }
              >
                {identity}
              </span>
            )}
            {!showIdentity && player.identityHidden !== false && (
              <span className={hiddenBadge}>暗</span>
            )}
          </div>
        </div>
        <div className={seatCharName}>{displayChar || '未知'}</div>
      </div>
      {/* 体力红心 — \uFE0E 强制文本渲染,防止 iOS Safari 将 ♥ 渲染为彩色 emoji 导致空血心也显示红色 */}
      <div className={seatHpRow} style={{ gap: hpGap }}>
        {Array.from({ length: player.maxHealth }, (_, i) => {
          const isFull = i < player.health;
          return (
            <span
              key={i}
              className={cx(
                isFull ? hpHeartFull : hpHeartEmpty,
                isDamaged && hpFlash,
                isHealed && hpHealFlash,
              )}
              style={{ fontSize: isFull ? hpFullSize : hpEmptySize }}
            >
              ♥{'\uFE0E'}
            </span>
          );
        })}
      </div>
      {/* 技能标签 */}
      {(() => {
        const isLordSeat = player.identity === '主公';
        const seatVisibleSkills = player.skills
          .filter((s) => !DEFAULT_SKILLS.has(s))
          .filter((s) => !EQUIPMENT_SKILL_NAMES.has(s))
          .filter((s) => isLordSeat || !LORD_SKILLS.has(s));
        if (seatVisibleSkills.length === 0) return null;
        return (
          <div className={skillRow}>
            {seatVisibleSkills.map((s) => (
              // 描述按原 id(s)查询;展示名去前导"界"
              <SkillTag key={s} name={displaySkillName(s)} description={getSkillDescription(s)} className={skillTag} />
            ))}
          </div>
        );
      })()}
      {/* 手牌数 + 基本信息 */}
      <div className={infoRow}>
        <span>手牌: {player.handCount}</span>
      </div>
      {/* 装备区 */}
      {Object.keys(player.equipment).length > 0 && (
        <div className={equipRow}>
          {Object.entries(player.equipment).map(([slot, cardId]) => {
            const card = view.cardMap[cardId];
            const icon = EQUIP_SLOT_ICON[slot as EquipSlot] ?? '💎';
            return (
              <span key={slot} title={card ? `${card.name}(${slot})` : String(cardId)}>
                {icon}
                {card?.name ?? cardId}
              </span>
            );
          })}
        </div>
      )}
      {/* 判定区(延时锦囊) */}
      {(() => {
        const ids = player.pendingTricks ?? [];
        if (ids.length === 0) return null;
        return (
          <div className={judgeRow}>
            <span className={judgeRowLabel}>判定:</span>
            {ids.map((cardId: string) => {
              const card = view.cardMap[cardId];
              const suitColor = SUIT_COLOR[card?.suit ?? '♠'] ?? '#ccc';
              const desc = card?.description ?? '';
              return (
                <span
                  key={cardId}
                  className={judgeTag}
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
      {(() => {
        // 'chained' 已由座位卡铁链光泽 + ⛓ 徽章代表,这里不重复显示原始标记名
        const visibleMarks = player.marks.filter((m) => m.id !== 'chained');
        if (visibleMarks.length === 0) return null;
        return (
          <div className={markRow}>
            {visibleMarks.map((m) => (
              <span key={m.id} className={markTag}>
                {m.id}
                {m.payload ? `(${JSON.stringify(m.payload)})` : ''}
              </span>
            ))}
          </div>
        );
      })()}
      </div>
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
    prev.isTurnGlow === next.isTurnGlow &&
    prev.turnGlowVersion === next.turnGlowVersion &&
    prev.hideIdentity === next.hideIdentity &&
    prev.isDisconnected === next.isDisconnected &&
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

// ─── Styles ───
const seatCard = css`
  position: relative;
  box-sizing: border-box;
  border: 1px solid #444;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.5);
  transition: all 0.25s;
  /* 与底栏 PlayerCardLarge 同尺寸:高度统一为 --hero-card-h,宽度撑满 seatArcSlot(= 卡高 × 15/19) */
  height: var(--hero-card-h);
  width: 100%;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
`;
// 势力色顶部条:武将名 + 身份
const seatCardHeader = css`
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--faction-color, transparent);
`;
const seatCardHeaderTop = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;
const seatCharName = css`
  font-weight: bold;
  font-size: 15px;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
`;
// 武将立绘作座位卡背景:绝对定位填满整张卡,文字内容浮在其上
const seatCharImgWrap = css`
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: var(--faction-color, rgba(0, 0, 0, 0.5));
`;
const seatCharImg = css`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
`;
const seatCharImgDead = css`
  filter: grayscale(1) brightness(0.7);
`;
// 座位卡内容层:浮在立绘上,底部渐变蒙版保证文字可读
const seatCardContent = css`
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.78) 0%,
    rgba(0, 0, 0, 0.45) 50%,
    rgba(0, 0, 0, 0) 100%
  );
`;
// 体力行:红心表示 HP
const seatHpRow = css`
  display: flex;
  gap: 2px;
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.3);
`;
const hpHeartFull = css`
  color: #e74c3c;
  font-size: 16px;
  text-shadow: 0 0 4px rgba(231, 76, 60, 0.5);
`;
const hpHeartEmpty = css`
  color: #555;
  font-size: 14px;
`;
const seatCardActive = css`
  box-shadow:
    0 0 18px rgba(255, 215, 0, 0.35),
    inset 0 0 8px rgba(255, 215, 0, 0.1);
  outline: 2px solid #ffd700;
`;
const seatCardPerspective = css`
  border: 2px solid #3498db;
  box-shadow: 0 0 8px rgba(52, 152, 219, 0.25);
`;
const seatCardDead = css`
  opacity: 0.35;
  filter: grayscale(1);
`;
const seatCardClickable = css`
  cursor: pointer;
  &:hover {
    outline: 2px solid #e74c3c;
  }
`;
// 选目标时不可选的座位置灰(距离外/不满足槽位条件),与可选座位形成视觉对比
const seatCardUntargetable = css`
  opacity: 0.4;
  filter: grayscale(0.8);
  cursor: not-allowed;
`;
const seatCardTargeted = css`
  outline: 3px solid #e74c3c;
  box-shadow: 0 0 12px rgba(231, 76, 60, 0.4);
`;
// 横置(铁索连环):铁灰光泽脉冲边框,代表武将牌横置状态(与回合金边/选中红边区分)
const seatCardChained = css`
  border-color: #8aa6b8;
  animation: chainPulse 1.8s ease-in-out infinite;
`;
const seatName = css`
  font-weight: bold;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
`;
const seatIndexBadge = css`
  display: inline-block;
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.6);
  border-radius: 3px;
  padding: 1px 5px;
  margin-right: 4px;
  font-size: 10px;
  font-weight: normal;
  vertical-align: middle;
`;
const youBadge = css`
  background: #3498db;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 9px;
  color: #fff;
  margin-left: 4px;
  font-weight: bold;
`;
const turnBadge = css`
  background: #ffd700;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 9px;
  color: #000;
  margin-left: 4px;
  font-weight: bold;
`;
// 连环徽章:铁灰底 + 铁链图标,标示横置(铁索连环)状态
const chainBadge = css`
  display: inline-block;
  background: linear-gradient(135deg, #6b8294, #9bb3c4);
  border: 1px solid #b9cdd9;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 11px;
  color: #fff;
  margin-left: 4px;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
`;
// 离线角标:灰底,标示该玩家 SSE 已断开(重连宽限期内)
const offlineBadge = css`
  display: inline-block;
  background: #888;
  border: 1px solid #aaa;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  color: #fff;
  margin-left: 4px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
`;
// 断线座位置灰(与死亡置灰区分:断线保持立绘可见,仅降透明度)
const seatCardDisconnected = css`
  opacity: 0.6;
`;
const lordBadge = css`
  background: #ffd700;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 9px;
  color: #4a2800;
  margin-left: 4px;
  font-weight: bold;
`;
const loyalistBadge = css`
  background: #4a90e2;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 9px;
  color: #fff;
  margin-left: 4px;
  font-weight: bold;
`;
const rebelBadge = css`
  background: #e74c3c;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 9px;
  color: #fff;
  margin-left: 4px;
  font-weight: bold;
`;
const renegadeBadge = css`
  background: #9b59b6;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 9px;
  color: #fff;
  margin-left: 4px;
  font-weight: bold;
`;
const hiddenBadge = css`
  background: #555;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  color: #bbb;
  margin-left: 4px;
  font-weight: bold;
`;
const equipRow = css`
  font-size: 11px;
  color: #f39c12;
  padding: 0 10px 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;
// 判定区(延时锦囊):斜体、紫色边框,亮眼能看清
const judgeRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 11px;
`;
const judgeRowLabel = css`
  color: #b78bff;
  font-weight: bold;
`;
const judgeTag = css`
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--suit-color, #ccc);
  color: var(--suit-color, #ccc);
  background: rgba(155, 89, 182, 0.12);
  font-weight: bold;
`;
const skillRow = css`
  margin-bottom: 4px;
  padding: 2px 10px;
`;
const skillTag = css`
  display: inline-block;
  background: rgba(15, 52, 96, 0.6);
  border-radius: 3px;
  padding: 1px 5px;
  margin-right: 3px;
  font-size: 10px;
  color: #8899aa;
`;
const infoRow = css`
  font-size: 11px;
  color: #999;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 10px 4px;
`;
const markRow = css`
  font-size: 10px;
  color: #666;
  padding: 0 10px 4px;
`;
const markTag = css`
  margin-right: 6px;
`;
// 死亡「亡」小标签
const deadBadgeText = css`
  font-size: 10px;
  color: #fff;
  margin-left: 2px;
`;

// ─── 动画状态样式 ───
const hpFlash = css`
  animation: damageFlash 0.6s ease-out both;
`;
const seatShaking = css`
  animation: damageShake 0.5s ease-out both;
`;
const seatDamageOverlay = css`
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    pointer-events: none;
    animation: damageOverlay 0.6s ease-out both;
  }
  position: relative;
`;
const turnGlowing = css`
  animation: newTurnGlow 0.8s ease-out both;
`;
const hpHealFlash = css`
  animation: healFlash 0.6s ease-out both;
`;
const seatHealOverlay = css`
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    pointer-events: none;
    animation: healOverlay 0.6s ease-out both;
  }
  position: relative;
`;
