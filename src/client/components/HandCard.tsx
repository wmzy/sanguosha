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
  onClick: () => void;
}

export function HandCard(props: HandCardProps) {
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
    onClick,
  } = props;

  const canClick = canPlay || isAwaiting || canDiscardClick || isTransformActive || (isDistributeActive && isDistributeCandidate);
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
        (!canPlay && !isAwaiting && !canDiscardClick && !isTransformActive && !isDistributeCandidate) && styles.handCardDisabled,
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
      style={{ transform: `rotate(${fanAngle}deg)`, zIndex: index }}
      onClick={() => canClick && !isTransformDisabled && !isDistributeDisabled && onClick()}
      title={
        isTransformMatch && transformWrapperName
          ? `${displayName} ${card.suit}${card.rank}\n(原:${card.name}) ${card.description ?? ''}`.trim()
          : `${card.name} ${card.suit}${card.rank}\n${card.description ?? ''}`
      }
    >
      <div className={styles.cardName} style={{ color: suitColor }}>{displayName}</div>
      {isTransformMatch && transformWrapperName && (
        <div className={styles.cardOrigin} style={{ color: suitColor }}>(原: {card.name})</div>
      )}
      <div className={styles.cardSuit} style={{ color: suitColor }}>{card.suit}{card.rank}</div>
    </div>
  );
}