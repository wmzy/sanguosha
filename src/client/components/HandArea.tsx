// src/client/components/HandArea.tsx
// 底栏手牌区:阶段/手牌数标题条、distribute 外部候选区、手牌列表(选中/弃选/
// 回应选中/canPlay 置灰/转化高亮/distribute 高亮、拖拽重排)与无手牌/旁观空态。
//
// 职责:渲染 GameView bottomLayout 的 handColumn 区块。卡片级派生
// (isSelected/isDiscardSelected/isRespondSelected/canPlay/isAwaiting/isTransform*/
// isDist*)留在本组件渲染循环内;窗口级判定(canPlayHandCard/isRespondableCard/
// canDiscardClick 等)由 GameView 传入——它们与数字键快捷键共用同一判定源,
// 必须保持同源(「点击置灰的牌数字键也无效果」)。HandCard 的 props 与拖拽
// handlers 自 GameView 逐字搬移,无行为改动。
// 共享数据(perspectiveName/canOperate)来自 GameViewCtx,专属数据仍走 props。

import { cx } from '@linaria/core';
import type { CSSProperties, RefObject } from 'react';
import * as styles from './gameViewStyles';
import { HandCard } from './HandCard';
import { displayCardName } from '../utils/gameViewHelpers';
import { SUIT_COLOR } from './gameViewConstants';
import type { Card } from '../../engine/types';
import type { PlayInteractionResult } from '../hooks/usePlayInteraction';
import { useGameView } from './GameViewCtx';

interface Props {
  /** 出牌交互状态机结果(选中/转化/distribute 状态 + handleCardClick) */
  play: PlayInteractionResult;
  /** 当前阶段名(标题条徽标) */
  phase: string;
  /** 是否旁观视角(手牌隐藏,显示空态提示) */
  isSpectating: boolean;
  /** 当前视角手牌(非旁观标题计数与空态判断) */
  perspectiveHand: Card[];
  /** 旁观标题展示的手牌张数(view 侧权威计数;旁观视角 hand 为空数组) */
  spectatorHandCount: number;
  /** 手牌列表容器 ref(出牌飞行动画定位用) */
  handListRef: RefObject<HTMLDivElement | null>;
  /** 按本地重排顺序排好的手牌(useHandReorder) */
  orderedHand: Card[];
  /** 拖拽重排 handler(useHandReorder) */
  handleDragStart: (idx: number) => void;
  /** 拖拽重排 handler(useHandReorder) */
  handleDrop: (targetIdx: number) => void;
  /** 自由出牌可选判定(与数字键快捷键同源) */
  canPlayHandCard: (card: Card) => boolean;
  /** respond 回应可选判定(与数字键快捷键同源) */
  isRespondableCard: (card: Card) => boolean;
  /** 弃牌窗口整手牌可选 */
  canDiscardClick: boolean;
  /** 当前视角在等待回应且可操作 */
  isMyAwaiting: boolean;
  /** 是否轮到当前视角出牌 */
  isMyTurn: boolean;
  /** 整理手牌:拖拽重排提交;不提供则手牌不可拖拽 */
  onReorderHand?: (order: string[]) => void;
}

/** 底栏手牌区(原 GameView bottomLayout handColumn 的整体搬移)。 */
export function HandArea({
  play,
  phase,
  isSpectating,
  perspectiveHand,
  spectatorHandCount,
  handListRef,
  orderedHand,
  handleDragStart,
  handleDrop,
  canPlayHandCard,
  isRespondableCard,
  canDiscardClick,
  isMyAwaiting,
  isMyTurn,
  onReorderHand,
}: Props) {
  // 共享数据来自 GameViewCtx(perspectiveName/canOperate)
  const { perspectiveName, canOperate } = useGameView();
  const {
    selectedCardId,
    selectedForDiscard,
    transformMode,
    activeDistribute,
    isDistributeActive,
    distSelected,
    distAllocations,
    distExternalCandidates,
    selectedRespondCardId,
    isKillRespondContext,
    handleCardClick,
  } = play;

  return (
      <div className={styles.handColumn}>
        <div className={styles.handHeader}>
          <div className={styles.phaseStrip}>
            <span className={styles.phaseStripBadge}>{phase}</span>
            <span className={styles.handTitle}>
              {isSpectating
                ? `👁 旁观 · ${perspectiveName} 手牌 ${spectatorHandCount} 张`
                : `手牌 (${perspectiveHand.length})`}
              {isDistributeActive && activeDistribute && (
                <span className={cx(styles.debugHint, styles.distHint)}>
                  {' '}
                  · {activeDistribute.prompt.title} · 已选 {distSelected.size}
                </span>
              )}
            </span>
          </div>
        </div>
        {/* distribute 外部候选区:候选牌不在手牌/装备区时(观星/界破军等),单独渲染。
            点点击触发同一 handleCardClick → handleDistToggle(复用主流程候选选择逻辑)。n                手牌区/装备区的候选高亮仍由原逻辑处理,本区只补充"不在那些区域"的牌。 */}
        {isDistributeActive && distExternalCandidates.length > 0 && (
          <div className={styles.distExternalWrap}>
            <span className={styles.distExternalLabel}>
              {activeDistribute?.prompt.title ?? '候选牌'} · 已选 {distSelected.size}
            </span>
            <div className={styles.distExternalList}>
              {distExternalCandidates.map((card) => {
                const isSelected = distSelected.has(card.id);
                const isAllocated = distAllocations.some((a) =>
                  a.cardIds.includes(card.id),
                );
                return (
                  <div
                    key={card.id}
                    data-card-id={card.id}
                    className={cx(
                      styles.distExternalCard,
                      isSelected && styles.handCardDistributeSelected,
                      isAllocated && styles.handCardDistributeAllocated,
                      !isSelected && !isAllocated && styles.handCardDistributeCandidate,
                    )}
                    style={
                      { '--suit-color': SUIT_COLOR[card.suit] ?? '#ccc' } as CSSProperties
                    }
                    onClick={() => handleCardClick(card)}
                    title={`${displayCardName(card.name, card.damageType)} ${card.suit}${card.rank}`}
                  >
                    <div className={styles.cardName}>{displayCardName(card.name, card.damageType)}</div>
                    <div className={styles.cardSuit}>
                      {card.suit}
                      {card.rank}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* 手牌区 */}
        <div className={styles.handList} ref={handListRef}>
          {orderedHand.map((card, i) => {
            const isSelected =
              selectedCardId === card.id ||
              !!(
                transformMode &&
                transformMode.minCards > 1 &&
                transformMode.selectedCardIds.includes(card.id)
              );
            const isDiscardSelected = selectedForDiscard.includes(card.id);
            // useCard 类回应:选中牌高亮(仅回应窗口生效,与弃牌/出牌阶段互斥)
            const isRespondSelected =
              isMyAwaiting && !isDistributeActive && selectedRespondCardId === card.id;
            // canPlay / isAwaiting / canDiscardClick 与数字键快捷键共用同一判定
            // (canPlayHandCard/isRespondableCard/canDiscardClick),保证键盘与点击
            // 的可选/置灰语义完全一致。
            const canPlay = canPlayHandCard(card);
            const isAwaiting = isRespondableCard(card);
            const isTransformCandidate = !!transformMode?.cardFilter(card);
            const isTransformActive =
              transformMode !== null && canOperate && (isMyTurn || isKillRespondContext);
            const isTransformMatch =
              isTransformCandidate &&
              (transformMode?.minCards === 1 ||
                !!transformMode?.selectedCardIds.includes(card.id));
            const isTransformDisabled = isTransformActive && !isTransformCandidate;
            const distCandidateIds = activeDistribute ? new Set(activeDistribute.cardIds) : null;
            const isDistCandidate = isDistributeActive && !!distCandidateIds?.has(card.id);
            const isDistSelected = isDistributeActive && distSelected.has(card.id);
            const isDistAllocated =
              isDistributeActive && distAllocations.some((a) => a.cardIds.includes(card.id));
            return (
              <div
                key={card.id}
                draggable={
                  !!onReorderHand && !isSelected && !isDiscardSelected && !isDistSelected
                }
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(i)}
              >
                <HandCard
                  card={card}
                  index={i}
                  totalHand={orderedHand.length}
                  isSelected={isSelected}
                  isDiscardSelected={isDiscardSelected}
                  isRespondSelected={isRespondSelected}
                  canPlay={canPlay}
                  isAwaiting={isAwaiting}
                  canDiscardClick={canDiscardClick}
                  isTransformMatch={isTransformMatch}
                  isTransformActive={isTransformActive}
                  isTransformDisabled={isTransformDisabled}
                  transformWrapperName={transformMode?.wrapperName}
                  isDistributeCandidate={isDistCandidate}
                  isDistributeSelected={isDistSelected}
                  isDistributeAllocated={isDistAllocated}
                  isDistributeActive={isDistributeActive}
                  onCardClick={handleCardClick}
                />
              </div>
            );
          })}
          {isSpectating ? (
            <div className={styles.emptyHand}>手牌已隐藏 · 申请查看该玩家视角可见手牌</div>
          ) : (
            perspectiveHand.length === 0 && <div className={styles.emptyHand}>无手牌</div>
          )}
        </div>
      </div>
  );
}
