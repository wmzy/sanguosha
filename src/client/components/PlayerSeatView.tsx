// src/client/components/PlayerSeatView.tsx
// 玩家座位视图(弧形座位上的每张武将卡) — 从 GameView.tsx 抽出。
// 结构对齐官方 OL 客户端:卡上方名牌(身份章+玩家名+徽章组) + 竖版立绘卡本体
// (卡内左缘竖带:势力章/竖排武将名/体力数字;右缘骑边体力珠列;右下手牌角标;
// 死亡「亡」印章) + 卡下小标签行(装备/判定/技能/标记)。
import { memo } from 'react';
import { css, cx } from '@linaria/core';
import type { EquipSlot, GameView } from '../../engine/types';
import { shallowArrayEqual, playerVisibleEqual } from '../utils/memo';
import type { SkillActionDef } from '../skillActionRegistry';
import { getSkillDescription } from '../../engine/skills/lifecycle';
import { useSkillDescReady } from '../hooks/useSkillDescReady';
import type { HpChangeNumber } from '../hooks/useAnimationState';
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
}: PlayerSeatProps) {
  useSkillDescReady(); // 技能模块加载后重渲染,确保 title 中 getSkillDescription 命中
  void turnGlowVersion; // 预留:未来用于触发不同强度的回合光环动画
  const isDead = !player.alive;
  // 横置(铁索连环):marks 含 'chained' —— 卡边框铁链光泽 + 立绘冷色调 + 连环徽章
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

  // 体力珠动态缩放:珠体基础 10×14px + 间距 3px,maxHealth ≥ 7 时整列高度会超出卡面,
  // 按 6/maxHealth 等比缩小珠体与间距,使任意 maxHealth 的珠列完整排在卡右缘内;
  // ≤ 6 沿用原值(标准 4 血场景无回归)。
  const hpScale = player.maxHealth >= 7 ? 6 / player.maxHealth : 1;
  const beadW = `${10 * hpScale}px`;
  const beadH = `${14 * hpScale}px`;
  const hpGap = `${3 * hpScale}px`;

  return (
    <div
      className={cx(
        seatRoot,
        isUntargetable && seatCardUntargetable,
        isDisconnected && seatCardDisconnected,
        isDamaged && seatShaking,
      )}
      data-player-name={player.name}
      data-seat-index={index}
      key={damageVersion > 0 || healVersion > 0 ? `dmg-${damageVersion}-heal-${healVersion}` : undefined}
      style={{ '--faction-color': factionColor } as React.CSSProperties}
      onClick={() => isClickable && onTargetClick(player.name)}
      onDoubleClick={() => onSeatDoubleClick?.(index)}
    >
      {/* 卡上方名牌:横向暗条(宽=卡宽)。左:身份小方章 + 座号 + 玩家名,右:徽章组(我/回合/⛓/离线) */}
      <div className={cx(seatNamePlate, isCurrentPlayer && seatNamePlateActive)}>
        {showIdentity && identity ? (
          <span
            className={cx(
              seatIdentityStamp,
              identity === '主公'
                ? seatIdentityLord
                : identity === '忠臣'
                  ? seatIdentityLoyalist
                  : identity === '反贼'
                    ? seatIdentityRebel
                    : identity === '内奸'
                      ? seatIdentityRenegade
                      : seatIdentityHidden,
            )}
          >
            {identity}
          </span>
        ) : (
          !showIdentity &&
          player.identityHidden !== false && <span className={cx(seatIdentityStamp, seatIdentityHidden)}>暗</span>
        )}
        <span className={seatIndexBadge}>#{index + 1}</span>
        <span className={seatName}>{player.name.slice(0, 6)}</span>
        <div className={seatBadgeGroup}>
          {isPerspective && <span className={youBadge}>我</span>}
          {isCurrentPlayer && <span className={turnBadge}>回合</span>}
          {isChained && (
            <span className={chainBadge} title="横置·铁索连环">
              ⛓
            </span>
          )}
          {isDisconnected && (
            <span className={offlineBadge} title="该玩家已断线,等待重连">
              离线
            </span>
          )}
        </div>
      </div>
      {/* 卡本体包裹层:relative 锚点,承载骑右边的体力珠列与漂浮数字(不被卡本体 overflow 裁剪) */}
      <div className={cx(seatCardWrap, isDamaged && seatDamageOverlay, isHealed && seatHealOverlay)}>
        {/* 卡本体:竖版立绘填满 + 细金铜描边 + 外圈深色,状态类全部挂在此层 */}
        <div
          className={cx(
            seatCard,
            isCurrentPlayer && seatCardActive,
            isPerspective && seatCardPerspective,
            isDead && seatCardDead,
            isClickable && seatCardClickable,
            isChained && seatCardChained,
            selectedTargetNames.includes(player.name) && seatCardTargeted,
            isTurnGlow && turnGlowing,
          )}
        >
          {/* 武将立绘:object-fit cover 填满卡面;无素材/404 时回退势力色背景 */}
          <div className={cx(seatCharImgWrap, !charImg && seatCharImgWrapEmpty, isChained && seatCharImgChained)} aria-hidden>
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
          {/* 卡内左缘竖带:顶部势力印章 + 中间竖排武将名 + 底部体力数字 */}
          <div className={seatSideBand}>
            <span className={seatFactionStamp} style={{ background: factionColor }}>
              {faction}
            </span>
            <span className={seatCharName}>{displayChar || '未知'}</span>
            <span className={cx(seatHpNumber, isDamaged && hpFlash, isHealed && hpHealFlash)}>
              {player.health}
            </span>
          </div>
          {/* 手牌数角标:卡内右下角小暗章(title 保留完整手牌信息) */}
          <span className={seatHandBadge} title={`手牌: ${player.handCount}`}>
            🂠 {player.handCount}
          </span>
          {/* 死亡印章:身份+阵亡 两行红字大印(立绘同时 grayscale),对齐官方「反贼/阵亡」印 */}
          {isDead && (
            <span className={seatDeadStamp} aria-hidden>
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
        {/* 右缘体力珠列:垂直排列,骑在卡右边框上;满珠绿渐变水滴,空珠透明底 */}
        <div className={seatHpBeadCol} style={{ gap: hpGap }} aria-hidden>
          {Array.from({ length: player.maxHealth }, (_, i) => (
            <span
              key={i}
              className={i < player.health ? seatHpBeadFull : seatHpBeadEmpty}
              style={{ width: beadW, height: beadH }}
            />
          ))}
        </div>
        {/* 体力变化漂浮数字:伤害「-N」红 / 回血「+N」绿,上浮渐隐(动画状态由 useAnimationState 定时清除) */}
        {hpChange && (
          <span
            key={`hpnum-${hpChange.version}`}
            className={cx(hpFloatNumber, hpChange.kind === 'heal' ? hpFloatHeal : hpFloatDamage)}
            aria-hidden
          >
            {hpChange.kind === 'heal' ? `+${hpChange.amount}` : `-${hpChange.amount}`}
          </span>
        )}
      </div>
      {/* 卡下小标签行:装备 / 判定 / 技能 chips / 标记(每行独立、紧凑) */}
      <div className={seatLabelCol}>
        {/* 装备行:暗条 chip + 图标 + 牌名 + 花色点数 */}
        {Object.keys(player.equipment).length > 0 && (
          <div className={equipRow}>
            {Object.entries(player.equipment).map(([slot, cardId]) => {
              const card = view.cardMap[cardId];
              const icon = EQUIP_SLOT_ICON[slot as EquipSlot] ?? '💎';
              const suitColor = SUIT_COLOR[card?.suit ?? '♠'] ?? '#ccc';
              return (
                <span key={slot} title={card ? `${card.name}(${slot})` : String(cardId)}>
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
        {/* 技能 chips:暗底金字小圆角 */}
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
        {(() => {
          // 'chained' 已由卡边框铁链光泽 + ⛓ 徽章代表,这里不重复显示原始标记名
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
    prev.hpChange?.kind === next.hpChange?.kind &&
    prev.hpChange?.amount === next.hpChange?.amount &&
    prev.hpChange?.version === next.hpChange?.version &&
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
// 座位根:名牌(上) + 武将卡本体(中) + 小标签行(下) 的纵向组合
const seatRoot = css`
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;
// 卡上方名牌:横向暗条,宽=卡宽。左:身份小方章 + 座号 + 玩家名,右:徽章组
const seatNamePlate = css`
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  box-sizing: border-box;
  min-height: 22px;
  padding: 2px 6px;
  background: linear-gradient(rgba(26, 21, 14, 0.95), rgba(15, 12, 8, 0.92));
  border: 1px solid #3a3226;
  border-radius: 4px;
  transition:
    border-color 0.25s,
    box-shadow 0.25s;
`;
// 当前回合:名牌同步高亮(金边微光,与卡本体金绿辉光呼应)
const seatNamePlateActive = css`
  border-color: #b28e4a;
  box-shadow: 0 0 8px rgba(255, 205, 92, 0.22);
`;
// 身份小方章 base:主公金/忠臣蓝/反贼红/内奸紫;未揭示时暗章「暗」
const seatIdentityStamp = css`
  flex-shrink: 0;
  min-width: 22px;
  text-align: center;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: bold;
  line-height: 1.5;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
`;
const seatIdentityLord = css`
  background: #d4a017;
  color: #3a2400;
`;
const seatIdentityLoyalist = css`
  background: #3f6fb5;
  color: #fff;
`;
const seatIdentityRebel = css`
  background: #b03a30;
  color: #fff;
`;
const seatIdentityRenegade = css`
  background: #8e5aa8;
  color: #fff;
`;
const seatIdentityHidden = css`
  background: #4a463d;
  color: #b9b2a0;
`;
// 座号小徽章
const seatIndexBadge = css`
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.55);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  font-weight: normal;
  line-height: 1.5;
`;
// 玩家名:白字粗体,超出省略
const seatName = css`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: bold;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
`;
// 名牌右侧徽章组
const seatBadgeGroup = css`
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
`;
const youBadge = css`
  background: rgba(52, 152, 219, 0.92);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  color: #fff;
  font-weight: bold;
  line-height: 1.5;
`;
const turnBadge = css`
  background: #d4a017;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  color: #241a04;
  font-weight: bold;
  line-height: 1.5;
`;
// 连环徽章:铁灰底 + 铁链图标,标示横置(铁索连环)状态
const chainBadge = css`
  display: inline-flex;
  align-items: center;
  background: linear-gradient(135deg, #6b8294, #9bb3c4);
  border: 1px solid #b9cdd9;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 10px;
  color: #fff;
  font-weight: bold;
  line-height: 1.5;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
`;
// 离线角标:灰底,标示该玩家 SSE 已断开(重连宽限期内)
const offlineBadge = css`
  background: #7a7a7a;
  border: 1px solid #9a9a9a;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 9px;
  color: #fff;
  font-weight: bold;
  line-height: 1.5;
`;
// 卡本体包裹层:relative 锚点(体力珠列/漂浮数字挂载点)
const seatCardWrap = css`
  position: relative;
  width: 100%;
  flex: 0 0 auto;
`;
// 卡本体:竖版立绘卡。细金铜描边(1px #8a7448)+ 外圈 1px 深色,圆角 6px;
// 高度统一 --hero-card-h,宽度撑满 seatArcSlot(= 卡高 × 15/19,与立绘 750×950 同比例)
const seatCard = css`
  position: relative;
  box-sizing: border-box;
  height: var(--hero-card-h);
  width: 100%;
  border: 1px solid #8a7448;
  border-radius: 6px;
  overflow: hidden;
  background: #14110c;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.6),
    0 6px 18px rgba(0, 0, 0, 0.45);
  transition:
    box-shadow 0.25s,
    border-color 0.25s,
    opacity 0.25s;
`;
// 当前回合:金绿双层辉光边框(与名牌高亮联动)
const seatCardActive = css`
  border-color: #d4a048;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.6),
    0 0 16px rgba(255, 205, 92, 0.45),
    0 0 32px rgba(110, 190, 100, 0.22),
    inset 0 0 12px rgba(255, 210, 100, 0.1);
`;
// 视角玩家:蓝色环(outline 与 box-shadow 辉光正交,可叠加)
const seatCardPerspective = css`
  outline: 2px solid rgba(52, 152, 219, 0.7);
  outline-offset: 1px;
`;
// 死亡:立绘 grayscale(见 seatCharImgDead)+ 卡面「亡」印章,整体轻降不透明度
const seatCardDead = css`
  opacity: 0.72;
`;
// 可点选目标:hover 红边提示
const seatCardClickable = css`
  cursor: pointer;
  &:hover {
    border-color: #e05545;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.6),
      0 0 14px rgba(231, 76, 60, 0.45);
  }
`;
// 横置(铁索连环):铁灰冷色调边框 + 铁链光泽脉冲(立绘同步降饱和,见 seatCharImgChained)
const seatCardChained = css`
  border-color: #8aa6b8;
  animation: chainPulse 1.8s ease-in-out infinite;
`;
// 被选为目标:红色脉冲边框(定义最靠后,目标态优先于回合金边/铁索冷光)
const seatCardTargeted = css`
  border-color: #e05545;
  animation: seatTargetPulse 1.2s ease-in-out infinite;
`;
// 武将立绘:绝对定位填满卡面;无素材/404 时回退势力色背景。
// ::after 暗化蒙版:立绘缺失时避免高饱和势力色平铺刺眼(官方立绘本身带暗调),
// 有立绘时蒙版同时压暗图底,保证左缘竖带/角标文字可读。
const seatCharImgWrap = css`
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: var(--faction-color, rgba(0, 0, 0, 0.5));

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 120% 90% at 50% 30%, transparent 40%, rgba(8, 6, 3, 0.5) 100%),
      linear-gradient(rgba(10, 8, 5, 0.34), rgba(10, 8, 5, 0.18));
  }
`;
// 无立绘素材的武将(回退势力色平铺):整层降饱和压亮,呈暗调势力色牌而非高饱和色块
const seatCharImgWrapEmpty = css`
  filter: saturate(0.5) brightness(0.62);
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
// 横置(铁索):立绘铁灰冷色调(降饱和压亮),与边框 chainPulse 呼应
const seatCharImgChained = css`
  filter: saturate(0.45) brightness(0.92);
`;
// 卡内左缘竖带:自上而下渐变暗带(rgba(0,0,0,.62)→透明),宽约 26px
const seatSideBand = css`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 26px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 7px 0 9px;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.62) 0%,
    rgba(0, 0, 0, 0.42) 60%,
    rgba(0, 0, 0, 0.08) 100%
  );
`;
// 势力印章:18px 方块,势力色底 + 金字(魏/蜀/吴/群)
const seatFactionStamp = css`
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  border: 1px solid rgba(240, 215, 138, 0.4);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    0 1px 3px rgba(0, 0, 0, 0.5);
  font-size: 10px;
  font-weight: bold;
  color: #f0d78a;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.7);
`;
// 竖排武将名:vertical-rl + upright,金白粗体带深色描边
const seatCharName = css`
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  writing-mode: vertical-rl;
  text-orientation: upright;
  font-weight: bold;
  font-size: 13px;
  letter-spacing: 3px;
  color: #f3e6c2;
  text-shadow:
    1px 0 2px rgba(0, 0, 0, 0.9),
    -1px 0 2px rgba(0, 0, 0, 0.9),
    0 1px 2px rgba(0, 0, 0, 0.9),
    0 -1px 2px rgba(0, 0, 0, 0.9);
`;
// 竖带底部体力数字(当前体力):红色粗体;伤害/回复红/绿闪烁挂在此处
const seatHpNumber = css`
  flex-shrink: 0;
  display: inline-block;
  line-height: 1;
  font-size: 16px;
  font-weight: 900;
  color: #ff5f52;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.85),
    0 0 6px rgba(255, 60, 40, 0.45);
`;
// 手牌数角标:卡内右下角小暗章「🂠 N」
const seatHandBadge = css`
  position: absolute;
  right: 4px;
  bottom: 4px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(138, 116, 72, 0.5);
  color: #e8c47a;
  font-size: 10px;
  font-weight: bold;
  line-height: 1.4;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
`;
// 死亡印章:旋转红字方印盖在卡面(立绘同时 grayscale)
// 有身份时两行「身份/阵亡」(对齐官方「反贼/阵亡」印),无身份时单字「亡」
const seatDeadStamp = css`
  position: absolute;
  top: 42%;
  left: 50%;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  transform: translate(-50%, -50%) rotate(-10deg);
  padding: 4px 8px;
  border: 3px solid rgba(200, 40, 34, 0.85);
  border-radius: 6px;
  background: rgba(20, 6, 4, 0.38);
  color: rgba(226, 56, 48, 0.94);
  font-size: 21px;
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: 3px;
  text-indent: 3px; /* 抵消 letter-spacing 造成的偏移 */
  text-shadow: 0 0 10px rgba(180, 30, 24, 0.6);
  pointer-events: none;

  & > i {
    font-style: normal;
    white-space: nowrap;
  }
`;
// 右缘体力珠列:垂直排列,骑在卡右边框上(right: -5px = 半珠宽);
// 满珠绿渐变水滴(内高光+微光晕),空珠透明底 #444 边。尺寸由内联按 maxHealth 缩放
const seatHpBeadCol = css`
  position: absolute;
  right: -5px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
`;
const seatHpBeadFull = css`
  box-sizing: border-box;
  flex-shrink: 0;
  border-radius: 50% 50% 50% 0;
  transform: rotate(-45deg);
  background: linear-gradient(135deg, #7ec850 8%, #3e8f2e 92%);
  border: 1px solid rgba(46, 94, 28, 0.9);
  box-shadow:
    inset 0 2px 2px rgba(255, 255, 255, 0.35),
    inset 0 -1px 2px rgba(0, 0, 0, 0.25),
    0 0 6px rgba(126, 200, 80, 0.45);
`;
const seatHpBeadEmpty = css`
  box-sizing: border-box;
  flex-shrink: 0;
  border-radius: 50% 50% 50% 0;
  transform: rotate(-45deg);
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid #444;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.55);
`;
// 卡下小标签行容器
const seatLabelCol = css`
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
`;
// 装备行:暗条 chip + 图标 + 牌名 + 花色点数(如 ⚔贯石斧5♦)
const equipRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  & > span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 100%;
    overflow: hidden;
    font-size: 10px;
    color: #ecd9a8;
    background: rgba(12, 10, 7, 0.72);
    border: 1px solid rgba(138, 116, 72, 0.4);
    border-radius: 3px;
    padding: 1px 6px;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
`;
// 判定行(延时锦囊):紫边 chip
const judgeRow = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  font-size: 10px;
`;
const judgeRowLabel = css`
  color: #c9a2ff;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
`;
const judgeTag = css`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid #8e6cc8;
  color: var(--suit-color, #ccc);
  background: rgba(24, 16, 34, 0.78);
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
`;
// 技能 chips:暗底金字小圆角
const skillRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
`;
const skillTag = css`
  display: inline-block;
  background: rgba(10, 8, 6, 0.68);
  border: 1px solid rgba(138, 116, 72, 0.42);
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 10px;
  color: #e8c47a;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
`;
// 原始标记行(链式标记已由卡面表达,其余以小灰字展示)
const markRow = css`
  font-size: 10px;
  color: #777;
  padding: 0 2px;
`;
const markTag = css`
  margin-right: 6px;
`;
// 选目标时不可选的座位置灰(距离外/不满足槽位条件),与可选座位形成视觉对比
const seatCardUntargetable = css`
  opacity: 0.4;
  filter: grayscale(0.8);
  cursor: not-allowed;
`;
// 断线座位置灰(与死亡置灰区分:断线保持立绘可见,仅降透明度)
const seatCardDisconnected = css`
  opacity: 0.6;
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
    border-radius: 6px;
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
// 体力变化漂浮数字:绝对定位在座位卡中上部,上浮渐隐 1s(与 useAnimationState 清除时序对齐)
const hpFloatNumber = css`
  position: absolute;
  left: 50%;
  top: 38%;
  z-index: 6;
  font-size: 26px;
  font-weight: 700;
  font-family: inherit;
  pointer-events: none;
  animation: hpFloatUp 1s ease-out both;
`;
const hpFloatDamage = css`
  color: #ff4d4f;
  text-shadow: 0 0 6px rgba(255, 34, 34, 0.7), 0 1px 3px rgba(0, 0, 0, 0.9);
`;
const hpFloatHeal = css`
  color: #52c41a;
  text-shadow: 0 0 6px rgba(82, 196, 26, 0.7), 0 1px 3px rgba(0, 0, 0, 0.9);
`;
const seatHealOverlay = css`
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 6px;
    pointer-events: none;
    animation: healOverlay 0.6s ease-out both;
  }
  position: relative;
`;
