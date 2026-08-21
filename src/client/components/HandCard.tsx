import { memo } from 'react';
import { cx, css } from '@linaria/core';
import * as styles from './gameViewStyles';
import { SUIT_COLOR } from './gameViewConstants';
import { CardFace } from './CardFace';
import { cardTouchGuard, useCardDescOverlay } from './CardDescTooltip';
import type { Card } from '../../engine/types';

/**
 * hover 抬升补强:transform 位移 + 阴影加深(纯视觉,不改事件处理,
 * 不影响 HTML5 拖拽重排——draggable/落点由 GameView 的 DnD 事件驱动)。
 * 用 :hover:hover 提升一档优先级,确定性覆盖 gameViewStyles/hand.ts 中
 * handCard:hover 的 margin-bottom 抬升(margin 布局回流换成 GPU transform);
 * rotate(var(--fan-angle)) 必须保留,否则破坏扇形手牌排布。
 */
const handCardHoverLift = css`
  &:hover:hover {
    margin-bottom: 0;
    transform: rotate(var(--fan-angle, 0deg)) translateY(-10px) scale(1.04);
    box-shadow:
      0 12px 26px rgba(0, 0, 0, 0.65),
      0 0 16px rgba(217, 180, 92, 0.3);
    border-color: #e6c06a;
    filter: brightness(1.08);
  }
`;

export interface HandCardProps {
  card: Card;
  index: number;
  totalHand: number;
  isSelected: boolean;
  isDiscardSelected: boolean;
  /** useCard 类回应:该牌已被选中(待点「打出」出牌) */
  isRespondSelected: boolean;
  canPlay: boolean;
  isAwaiting: boolean;
  canDiscardClick: boolean;
  isTransformMatch: boolean;
  isTransformActive: boolean;
  isTransformDisabled: boolean;
  transformWrapperName?: string;
  /** distribute(仁德/制衡/遗计):该牌是候选可分配牌 */
  isDistributeCandidate?: boolean;
  /** distribute:该牌已被选中(待分配或待提交) */
  isDistributeSelected?: boolean;
  /** distribute:该牌已分配给某目标(allocate 模式) */
  isDistributeAllocated?: boolean;
  /** distribute 上下文激活(控制禁用逻辑:非候选牌变灰) */
  isDistributeActive?: boolean;
  /** 点击手牌(传入 card 对象,稳定引用避免内联闭包破坏 memo) */
  onCardClick: (card: Card) => void;
}

export function HandCardImpl(props: HandCardProps) {
  const {
    card,
    index,
    totalHand,
    isSelected,
    isDiscardSelected,
    isRespondSelected,
    canPlay,
    isAwaiting,
    canDiscardClick,
    isTransformMatch,
    isTransformActive,
    isTransformDisabled,
    transformWrapperName,
    isDistributeCandidate = false,
    isDistributeSelected = false,
    isDistributeAllocated = false,
    isDistributeActive = false,
    onCardClick,
  } = props;

  const canClick =
    canPlay ||
    isAwaiting ||
    canDiscardClick ||
    isTransformActive ||
    (isDistributeActive && isDistributeCandidate);
  const isDistributeDisabled = isDistributeActive && !isDistributeCandidate;
  const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
  const displayName = isTransformMatch && transformWrapperName ? transformWrapperName : card.name;
  const fanAngle = totalHand > 1 ? -10 + 20 * (index / (totalHand - 1)) : 0;

  // 牌描述浮层(替代原生 title):桌面 hover / 触屏长按 500ms 触发。
  // 状态全在组件内部,不新增 props,不影响 memo 比较;卸载自动清理计时器。
  const tip = useCardDescOverlay({
    name: displayName,
    suit: card.suit,
    rank: card.rank,
    description: card.description,
    originName: isTransformMatch && transformWrapperName ? card.name : undefined,
    suitColor,
  });

  return (
    <div
      ref={tip.bind.ref}
      data-card-id={card.id}
      className={cx(
        styles.handCard,
        handCardHoverLift,
        cardTouchGuard,
        isSelected && styles.handCardSelected,
        !canPlay &&
          !isAwaiting &&
          !canDiscardClick &&
          !isTransformActive &&
          !isDistributeCandidate &&
          styles.handCardDisabled,
        // 弃牌阶段:未选中的可选牌紫色呼吸引导;已选中走 discardCardSelected
        canDiscardClick && !isDiscardSelected && styles.handCardDiscardable,
        // 出牌阶段:可主动打出的牌轻量提亮(回应/弃牌/转化/distribute 各有专属高亮)
        canPlay &&
          !isAwaiting &&
          !canDiscardClick &&
          !isTransformActive &&
          !isDistributeActive &&
          styles.handCardPlayable,
        isAwaiting && styles.handCardRespondable,
        isDiscardSelected && styles.discardCardSelected,
        isRespondSelected && styles.handCardRespondSelected,
        isTransformMatch && styles.handCardTransform,
        isTransformDisabled && styles.handCardTransformDisabled,
        isDistributeCandidate && styles.handCardDistributeCandidate,
        isDistributeSelected && styles.handCardDistributeSelected,
        isDistributeAllocated && styles.handCardDistributeAllocated,
        isDistributeDisabled && styles.handCardDisabled,
      )}
      style={
        {
          '--fan-angle': `${fanAngle}deg`,
          '--card-z': index,
          '--suit-color': suitColor,
        } as React.CSSProperties
      }
      onClick={() => {
        // 长按触发后抬起的 click / 浮层开着时点卡关闭:均被浮层吞掉,不选牌
        if (tip.consumeClick()) return;
        if (canClick && !isTransformDisabled && !isDistributeDisabled) onCardClick(card);
      }}
      onMouseEnter={tip.bind.onMouseEnter}
      onMouseLeave={tip.bind.onMouseLeave}
      onTouchStart={tip.bind.onTouchStart}
      onTouchEnd={tip.bind.onTouchEnd}
      onTouchMove={tip.bind.onTouchMove}
      onContextMenu={tip.bind.onContextMenu}
    >
      {/* 卡牌牌面:cards-local 图片(object fallback)或 HTML 绘制牌面 */}
      <CardFace name={card.name} suit={card.suit} rank={card.rank} size="normal" damageType={card.damageType} />
      {/* 转化模式标注层:仅在武圣等转化牌时叠加显示转化后牌名 + 原牌名 */}
      {isTransformMatch && transformWrapperName && (
        <div className={styles.handCardMeta}>
          <div className={styles.cardName}>{displayName}</div>
          <div className={styles.cardOrigin}>(原: {card.name})</div>
        </div>
      )}
      {/* 牌描述浮层:portal 到 body,不受手牌区裁剪/扇形 z-index 影响 */}
      {tip.overlay}
    </div>
  );
}

/**
 * React.memo 自定义比较器:
 * 手牌渲染 N 次(每张牌),每次 view 更新都会重新 map。
 * card 对象引用每次变化,但 card 字段(name/suit/rank)不可变,用 card.id 比较即可。
 * onCardClick 来自 usePlayInteraction 的 useCallback,状态不变时引用稳定。
 */
function handCardPropsEqual(prev: HandCardProps, next: HandCardProps): boolean {
  return (
    prev.card.id === next.card.id &&
    prev.index === next.index &&
    prev.totalHand === next.totalHand &&
    prev.isSelected === next.isSelected &&
    prev.isDiscardSelected === next.isDiscardSelected &&
    prev.isRespondSelected === next.isRespondSelected &&
    prev.canPlay === next.canPlay &&
    prev.isAwaiting === next.isAwaiting &&
    prev.canDiscardClick === next.canDiscardClick &&
    prev.isTransformMatch === next.isTransformMatch &&
    prev.isTransformActive === next.isTransformActive &&
    prev.isTransformDisabled === next.isTransformDisabled &&
    prev.transformWrapperName === next.transformWrapperName &&
    prev.isDistributeCandidate === next.isDistributeCandidate &&
    prev.isDistributeSelected === next.isDistributeSelected &&
    prev.isDistributeAllocated === next.isDistributeAllocated &&
    prev.isDistributeActive === next.isDistributeActive &&
    prev.onCardClick === next.onCardClick
  );
}

export const HandCard = memo(HandCardImpl, handCardPropsEqual);
