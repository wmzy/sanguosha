// src/client/components/CenterActionBar.tsx
// 底部操作坞中央动作条:respond 打出/不回应、转化全选/反选/使用、出牌、altActions
// 替代动作、取消选择、结束回合、弃牌确认/全选/反选/清空、distribute 全选/反选/清空/
// 提交/取消、已选目标提示。
//
// 职责:纯展示组件,渲染 GameView bottomSlot 内 showCenterActionBar 条件下的
// actionBar 按钮组。交互状态/handler 全部来自 usePlayInteraction 的 play 结果;
// 派生布尔(isRespondPending/showCancelSelection/showEndTurn 等)与 useHotkeys
// 严格同源,由 GameView 计算后传入,保证「按钮能点时快捷键才生效」的语义不变。
// 共享数据(canOperate)来自 GameViewCtx,专属数据(play/pending 等)仍走 props。
// 各按钮的 disabled/enabled/可见性条件自 GameView 逐字搬移,无任何行为改动。

import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import { CancelButton } from './CancelButton';
import { displaySkillName } from '../utils/skillDisplay';
import type { PendingView } from '../../engine/types';
import type { PlayInteractionResult } from '../hooks/usePlayInteraction';
import { useGameView } from './GameViewCtx';

interface Props {
  /** 出牌交互状态机结果(选中/转化/distribute 状态 + 全部 handler) */
  play: PlayInteractionResult;
  /** 当前 pending 原始对象(useCardAndTarget 时「不回应」文案为「交出武器」) */
  pending: PendingView | null;
  /** respond 窗口(打出/不回应)是否激活 */
  isRespondPending: boolean;
  /** 是否显示「取消选择」 */
  showCancelSelection: boolean;
  /** 是否显示「结束回合」 */
  showEndTurn: boolean;
  /** 是否本视角回合(目标提示行条件) */
  isMyTurn: boolean;
  /** 是否弃牌窗口 */
  isDiscardPhase: boolean;
  /** 当前视角是否在等待回应 */
  isPerspectiveAwaiting: boolean;
  /** 弃牌窗口最少张数 */
  discardMin: number;
  /** 弃牌窗口最多张数 */
  discardMax: number;
}

/** 中央动作条(原 GameView bottomSlot 内 actionBar 的整体搬移)。 */
export function CenterActionBar({
  play,
  pending,
  isRespondPending,
  showCancelSelection,
  showEndTurn,
  isMyTurn,
  isDiscardPhase,
  isPerspectiveAwaiting,
  discardMin,
  discardMax,
}: Props) {
  // 共享数据来自 GameViewCtx(canOperate)
  const { canOperate } = useGameView();
  const {
    selectedCardId,
    selectedTarget,
    selectedMultiTargets,
    selectedForDiscard,
    transformMode,
    distributeMode,
    activeDistribute,
    isDistributeActive,
    distSelected,
    distAllocations,
    distTargetName,
    selectedActive,
    playButtonState,
    selectedRespondCardId,
    respondTargetName,
    respondNeedsTarget,
    respondTargetReady,
    altActions,
    playRules,
    handlePlayCard,
    handleSkillAction,
    handleTransformPlay,
    isKillRespondContext,
    handleRespond,
    handlePlayRespond,
    handleEndTurn,
    handleConfirmDiscard,
    handleDiscardSelectAll,
    handleDiscardInvert,
    handleTransformSelectAll,
    handleTransformInvert,
    handleDistSubmit,
    handleDistClear,
    handleDistSelectAll,
    handleDistInvert,
    cancelSelection,
    clearDiscard,
    setDistributeMode,
  } = play;

  return (
      <div className={styles.actionBar}>
        {isRespondPending && (
          <>
            <button
              className={cx(
                styles.playBtn,
                (!selectedRespondCardId || !respondTargetReady) &&
                  styles.btnDisabled,
              )}
              onClick={handlePlayRespond}
              disabled={!selectedRespondCardId || !respondTargetReady}
            >
              打出
              {respondNeedsTarget
                ? respondTargetName
                  ? ` → ${respondTargetName}`
                  : ' (请选目标)'
                : ''}
            </button>
            <button className={styles.promptBtn} onClick={() => handleRespond()}>
              {pending?.prompt?.type === 'useCardAndTarget'
                ? '交出武器'
                : '不回应'}
            </button>
          </>
        )}
        {canOperate &&
          transformMode &&
          transformMode.minCards > 1 &&
          (() => {
            const ids = transformMode.selectedCardIds;
            return (
              <>
                <button
                  className={styles.promptBtn}
                  onClick={handleTransformSelectAll}
                  disabled={ids.length >= transformMode.maxCards}
                >
                  全选
                </button>
                <button
                  className={styles.promptBtn}
                  onClick={handleTransformInvert}
                  disabled={ids.length === 0}
                >
                  反选
                </button>
              </>
            );
          })()}
        {canOperate &&
          (selectedActive || isKillRespondContext) &&
          transformMode &&
          transformMode.minCards > 1 &&
          (() => {
            const ids = transformMode.selectedCardIds;
            const enough =
              ids.length >= transformMode.minCards &&
              ids.length <= transformMode.maxCards;
            // 回应路径(被询问杀):打出无目标,选满牌数即可提交 杀.respond
            const needsTarget = !isKillRespondContext && (transformMode.targetFilter
              ? transformMode.targetFilter.max >= 1
              : true);
            const canSubmit = enough && (!needsTarget || !!selectedTarget);
            return (
              <button
                className={cx(
                  styles.playBtn,
                  !canSubmit && styles.btnDisabled,
                )}
                onClick={() =>
                  canSubmit &&
                  handleTransformPlay(needsTarget ? selectedTarget! : '')
                }
                disabled={!canSubmit}
              >
                使用{transformMode.wrapperName}
                {!needsTarget
                  ? enough
                    ? ''
                    : ` (还需选 ${transformMode.minCards - ids.length} 张)`
                  : selectedTarget
                    ? ` → ${selectedTarget}`
                    : enough
                      ? ' (请选目标)'
                      : ` (还需选 ${transformMode.minCards - ids.length} 张)`}
              </button>
            );
          })()}
        {canOperate &&
          (selectedActive || isKillRespondContext) &&
          transformMode?.minCards === 1 &&
          selectedCardId &&
          (() => {
            // 回应路径(被询问杀):无需选目标,选中红牌即可提交 杀.respond
            if (isKillRespondContext) {
              return (
                <button
                  className={styles.playBtn}
                  onClick={() => handleTransformPlay('')}
                >
                  使用{transformMode.wrapperName}
                </button>
              );
            }
            return (
              <button
                className={cx(styles.playBtn, !selectedTarget && styles.btnDisabled)}
                onClick={() => selectedTarget && handleTransformPlay(selectedTarget)}
                disabled={!selectedTarget}
              >
                使用{transformMode.wrapperName}
                {selectedTarget ? ` → ${selectedTarget}` : ' (请选目标)'}
              </button>
            );
          })()}
        {canOperate &&
          selectedActive &&
          !transformMode &&
          selectedCardId &&
          playButtonState && (
            <button
              className={cx(
                styles.playBtn,
                !playButtonState.canPlay && styles.btnDisabled,
              )}
              onClick={handlePlayCard}
              disabled={!playButtonState.canPlay}
            >
              出牌{playButtonState.targetLabel}
            </button>
          )}
        {canOperate &&
          !transformMode &&
          selectedCardId &&
          altActions.length > 0 &&
          altActions.map((a) => (
            <button
              key={`${a.skillId}:${a.actionType}`}
              className={styles.playBtn}
              onClick={() => handleSkillAction(a)}
            >
              {displaySkillName(a.label)}
            </button>
          ))}
        {/* 取消选择:与出牌/alt 按钮同一行(actionBar),仅已选且处自由出牌窗口时显示 */}
        {!transformMode && showCancelSelection && (
          <CancelButton label="取消选择" onClick={cancelSelection} />
        )}
        {showEndTurn && (
          <button className={styles.endTurnBtn} onClick={handleEndTurn}>
            结束回合
          </button>
        )}
        {canOperate && isDiscardPhase && isPerspectiveAwaiting && (
          <>
            <button
              className={cx(
                styles.promptBtnPrimary,
                (selectedForDiscard.length < discardMin ||
                  selectedForDiscard.length > discardMax) &&
                  styles.btnDisabled,
              )}
              disabled={
                selectedForDiscard.length < discardMin ||
                selectedForDiscard.length > discardMax
              }
              onClick={handleConfirmDiscard}
            >
              确认弃牌 ({selectedForDiscard.length}/{discardMin})
            </button>
            <button
              className={styles.promptBtn}
              onClick={handleDiscardSelectAll}
              disabled={selectedForDiscard.length >= discardMax}
            >
              全选
            </button>
            <button
              className={styles.promptBtn}
              onClick={handleDiscardInvert}
              disabled={selectedForDiscard.length === 0}
            >
              反选
            </button>
            {selectedForDiscard.length > 0 && (
              <button className={styles.promptBtn} onClick={clearDiscard}>
                清空选择
              </button>
            )}
          </>
        )}
        {canOperate &&
          isDistributeActive &&
          activeDistribute &&
          (() => {
            const mode = activeDistribute.prompt.mode ?? 'allocate';
            const minTotal = activeDistribute.prompt.minTotal ?? 1;
            const maxTotal = activeDistribute.prompt.maxTotal ?? 99;
            let canSubmit: boolean;
            let label: string;
            if (mode === 'select') {
              canSubmit =
                distSelected.size >= minTotal && distSelected.size <= maxTotal;
              label = `确认(${distSelected.size})`;
            } else if (activeDistribute.externalTargetSelection) {
              canSubmit =
                distSelected.size >= minTotal &&
                distSelected.size <= maxTotal &&
                !!distTargetName;
              label = `确定(${distSelected.size})${distTargetName ? ` → ${distTargetName}` : ''}`;
            } else {
              const total = distAllocations.flatMap((a) => a.cardIds).length;
              canSubmit = total >= minTotal;
              label = `提交分配(${total})`;
            }
            return (
              <>
                {mode === 'select' && (
                  <button
                    className={styles.promptBtn}
                    onClick={handleDistSelectAll}
                    disabled={
                      distSelected.size >= activeDistribute.cardIds.length
                    }
                  >
                    全选
                  </button>
                )}
                {mode === 'select' && (
                  <button
                    className={styles.promptBtn}
                    onClick={handleDistInvert}
                    disabled={distSelected.size === 0}
                  >
                    反选
                  </button>
                )}
                <button
                  className={styles.promptBtn}
                  onClick={handleDistClear}
                  disabled={
                    distSelected.size === 0 && distAllocations.length === 0
                  }
                >
                  清空
                </button>
                <button
                  className={cx(
                    styles.promptBtnPrimary,
                    !canSubmit && styles.btnDisabled,
                  )}
                  onClick={handleDistSubmit}
                  disabled={!canSubmit}
                >
                  {label}
                </button>
                {distributeMode && (
                  <CancelButton
                    label="取消"
                    onClick={() => setDistributeMode(null)}
                  />
                )}
              </>
            );
          })()}
        {selectedCardId &&
          canOperate &&
          isMyTurn &&
          (playRules?.multiTarget
            ? selectedMultiTargets.length > 0
            : !!selectedTarget) && (
          <div className={styles.targetHint}>
            已选择目标:{' '}
            {playRules?.multiTarget
              ? selectedMultiTargets.join('、')
              : selectedTarget}
          </div>
        )}
      </div>
  );
}
