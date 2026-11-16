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
  /** 可回应牌张数(共享候选集,含装备区候选);0 时显示「无牌可出 · 不回应」一键按钮,null=未知(无 filter) */
  respondCandidateCount?: number | null;
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
  respondCandidateCount = null,
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
    transformWrapperName,
    distributeMode,
    activeDistribute,
    isDistributeActive,
    distSelected,
    distAllocations,
    distTargetName,
    selectedActive,
    playButtonState,
    transformSubmit,
    selectedRespondCardId,
    respondTargetName,
    respondNeedsTarget,
    respondTargetReady,
    altActions,
    playRules,
    handlePlayCard,
    handleSkillAction,
    handleTransformPlay,
    isRespondTransformContext,
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
      {isRespondPending &&
        (respondCandidateCount === 0 ? (
          // 无牌可出:不再渲染置灰的「打出」,只留一个醒目的一键跳过
          <button
            className={styles.promptBtnPrimary}
            onClick={() => handleRespond()}
            title="没有可回应的牌（快捷键 空格）"
          >
            {pending?.prompt?.type === 'useCardAndTarget'
              ? '没有武器可交 · 跳过'
              : '无牌可出 · 不回应'}
            <span className={styles.keyHint} aria-hidden>
              ␣
            </span>
          </button>
        ) : (
          <>
            <button
              className={cx(
                styles.playBtn,
                (!selectedRespondCardId || !respondTargetReady) && styles.btnDisabled,
              )}
              onClick={handlePlayRespond}
              disabled={!selectedRespondCardId || !respondTargetReady}
              title="快捷键 Enter（双击可回应牌可直接打出）"
            >
              打出
              {respondNeedsTarget
                ? respondTargetName
                  ? ` → ${respondTargetName}`
                  : ' (请选目标)'
                : ''}
              <span className={styles.keyHint} aria-hidden>
                ⏎
              </span>
            </button>
            <button
              className={styles.promptBtn}
              onClick={() => handleRespond()}
              title="快捷键 空格"
            >
              {pending?.prompt?.type === 'useCardAndTarget' ? '交出武器' : '不回应'}
              <span className={styles.keyHint} aria-hidden>
                ␣
              </span>
            </button>
          </>
        ))}
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
        (selectedActive || isRespondTransformContext) &&
        transformMode &&
        transformMode.minCards > 1 &&
        (() => {
          const ids = transformMode.selectedCardIds;
          const enough =
            ids.length >= transformMode.minCards && ids.length <= transformMode.maxCards;
          // 提交判定唯一来源 = play.transformSubmit(含 comboFilter 组合约束,乱击/界乱击
          // 两张须同花色):内联 enough&&target 漏 combo 会渲染出「可点但提交静默失败」
          // 的按钮。enough 只用于「还需选 N 张」计数文案。
          const needsTarget = transformSubmit?.needsTarget ?? false;
          const canSubmit = transformSubmit?.canSubmit ?? false;
          return (
            <button
              className={cx(styles.playBtn, !canSubmit && styles.btnDisabled)}
              onClick={() => canSubmit && handleTransformPlay(needsTarget ? selectedTarget! : '')}
              disabled={!canSubmit}
            >
              使用{transformWrapperName ?? transformMode.wrapperName}
              {!needsTarget
                ? enough
                  ? ''
                  : ` (还需选 ${transformMode.minCards - ids.length} 张)`
                : selectedTarget
                  ? ` → ${selectedTarget}`
                  : enough
                    ? ' (请选目标)'
                    : ` (还需选 ${transformMode.minCards - ids.length} 张)`}
              {canSubmit && (
                <span className={styles.keyHint} aria-hidden>
                  ⏎
                </span>
              )}
            </button>
          );
        })()}
      {canOperate &&
        (selectedActive || isRespondTransformContext) &&
        transformMode?.minCards === 1 &&
        selectedCardId &&
        (() => {
          // 回应路径(被询问杀):无需选目标,选中红牌即可提交 杀.respond
          if (isRespondTransformContext) {
            return (
              <button
                className={styles.playBtn}
                onClick={() => handleTransformPlay('')}
                title="快捷键 Enter"
              >
                使用{transformWrapperName ?? transformMode.wrapperName}
                <span className={styles.keyHint} aria-hidden>
                  ⏎
                </span>
              </button>
            );
          }
          return (
            <button
              className={cx(styles.playBtn, !selectedTarget && styles.btnDisabled)}
              onClick={() => selectedTarget && handleTransformPlay(selectedTarget)}
              disabled={!selectedTarget}
              title="快捷键 Enter（需先选目标）"
            >
              使用{transformWrapperName ?? transformMode.wrapperName}
              {selectedTarget ? ` → ${selectedTarget}` : ' (请选目标)'}
              {selectedTarget && (
                <span className={styles.keyHint} aria-hidden>
                  ⏎
                </span>
              )}
            </button>
          );
        })()}
      {canOperate && selectedActive && !transformMode && selectedCardId && playButtonState && (
        <button
          className={cx(styles.playBtn, !playButtonState.canPlay && styles.btnDisabled)}
          onClick={handlePlayCard}
          disabled={!playButtonState.canPlay}
          title="快捷键 Enter"
        >
          出牌{playButtonState.targetLabel}
          <span className={styles.keyHint} aria-hidden>
            ⏎
          </span>
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
        <CancelButton label="取消选择" onClick={cancelSelection} hotkey="Esc" />
      )}
      {showEndTurn && (
        <button className={styles.endTurnBtn} onClick={handleEndTurn} title="快捷键 E">
          结束回合
          <span className={styles.keyHint} aria-hidden>
            E
          </span>
        </button>
      )}
      {canOperate && isDiscardPhase && isPerspectiveAwaiting && (
        <>
          <button
            className={cx(
              styles.promptBtnPrimary,
              (selectedForDiscard.length < discardMin || selectedForDiscard.length > discardMax) &&
                styles.btnDisabled,
            )}
            disabled={
              selectedForDiscard.length < discardMin || selectedForDiscard.length > discardMax
            }
            onClick={handleConfirmDiscard}
            title="快捷键 Enter"
          >
            确认弃牌 ({selectedForDiscard.length}/{discardMin})
            <span className={styles.keyHint} aria-hidden>
              ⏎
            </span>
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
            canSubmit = distSelected.size >= minTotal && distSelected.size <= maxTotal;
            label = `确认(${distSelected.size})`;
          } else if (activeDistribute.externalTargetSelection) {
            canSubmit =
              distSelected.size >= minTotal && distSelected.size <= maxTotal && !!distTargetName;
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
                  disabled={distSelected.size >= activeDistribute.cardIds.length}
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
                disabled={distSelected.size === 0 && distAllocations.length === 0}
              >
                清空
              </button>
              <button
                className={cx(styles.promptBtnPrimary, !canSubmit && styles.btnDisabled)}
                onClick={handleDistSubmit}
                disabled={!canSubmit}
                title="快捷键 Enter"
              >
                {label}
                <span className={styles.keyHint} aria-hidden>
                  ⏎
                </span>
              </button>
              {distributeMode && (
                <CancelButton label="取消" onClick={() => setDistributeMode(null)} />
              )}
            </>
          );
        })()}
      {selectedCardId &&
        canOperate &&
        isMyTurn &&
        (playRules?.multiTarget ? selectedMultiTargets.length > 0 : !!selectedTarget) && (
          <div className={styles.targetHint}>
            已选择目标: {playRules?.multiTarget ? selectedMultiTargets.join('、') : selectedTarget}
          </div>
        )}
    </div>
  );
}
