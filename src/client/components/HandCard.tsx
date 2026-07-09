import { memo } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import { SUIT_COLOR } from './gameViewConstants';
import type { Card } from '../../engine/types';

export interface HandCardProps {
  card: Card;
  index: number;
  totalHand: number;
  isSelected: boolean;
  isDiscardSelected: boolean;
  canPlay: boolean;
  isAwaiting: boolean;
  canDiscardClick: boolean;
  isTransformMatch: boolean;
  isTransformActive: boolean;
  isTransformDisabled: boolean;
  isNew: boolean;
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
    canPlay,
    isAwaiting,
    canDiscardClick,
    isTransformMatch,
    isTransformActive,
    isTransformDisabled,
    isNew,
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

  return (
    <div
      data-card-id={card.id}
      className={cx(
        styles.handCard,
        isSelected && styles.handCardSelected,
        !canPlay &&
          !isAwaiting &&
          !canDiscardClick &&
          !isTransformActive &&
          !isDistributeCandidate &&
          styles.handCardDisabled,
        isAwaiting && styles.handCardRespondable,
        isDiscardSelected && styles.discardCardSelected,
        isNew && styles.handCardNew,
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
      onClick={() => canClick && !isTransformDisabled && !isDistributeDisabled && onCardClick(card)}
      title={
        isTransformMatch && transformWrapperName
          ? `${displayName} ${card.suit}${card.rank}\n(原:${card.name}) ${card.description ?? ''}`.trim()
          : `${card.name} ${card.suit}${card.rank}\n${card.description ?? ''}`
      }
    >
      <div className={styles.cardName}>{displayName}</div>
      {isTransformMatch && transformWrapperName && (
        <div className={styles.cardOrigin}>(原: {card.name})</div>
      )}
      <div className={styles.cardSuit}>
        {card.suit}
        {card.rank}
      </div>
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
    prev.canPlay === next.canPlay &&
    prev.isAwaiting === next.isAwaiting &&
    prev.canDiscardClick === next.canDiscardClick &&
    prev.isTransformMatch === next.isTransformMatch &&
    prev.isTransformActive === next.isTransformActive &&
    prev.isTransformDisabled === next.isTransformDisabled &&
    prev.isNew === next.isNew &&
    prev.transformWrapperName === next.transformWrapperName &&
    prev.isDistributeCandidate === next.isDistributeCandidate &&
    prev.isDistributeSelected === next.isDistributeSelected &&
    prev.isDistributeAllocated === next.isDistributeAllocated &&
    prev.isDistributeActive === next.isDistributeActive &&
    prev.onCardClick === next.onCardClick
  );
}

export const HandCard = memo(HandCardImpl, handCardPropsEqual);
