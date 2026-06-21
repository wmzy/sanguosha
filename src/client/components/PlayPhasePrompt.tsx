// src/client/components/PlayPhasePrompt.tsx
// 纯展示组件:出牌/distribute/弃牌 5 个并列提示块,逐字迁移自 GameView.tsx 662-746 行。
// 不持有任何业务状态,所有数据/回调由 props 传入。

import * as styles from './gameViewStyles';
import type { GameView, Card } from '../../engine/types';

export interface PlayPhasePromptProps {
  view: GameView;
  perspectiveName: string;
  currentPlayerName: string;
  perspectiveIdx: number;
  perspectiveHand: Card[];
  isPerspectiveTurn: boolean;
  isPerspectiveAwaiting: boolean;
  isDiscardPhase: boolean;
  isMyTurn: boolean;
  canOperate: boolean;
  selectedCardId: string | null;
  selectedTarget: string | null;
  discardMin: number;
  discardMax: number;
  selectedForDiscard: Set<string>;
  onClearDiscard: () => void;
  onConfirmDiscard: () => void;
}

export function PlayPhasePrompt(props: PlayPhasePromptProps) {
  const {
    view,
    perspectiveName,
    currentPlayerName,
    perspectiveIdx,
    perspectiveHand,
    isPerspectiveTurn,
    isPerspectiveAwaiting,
    isDiscardPhase,
    isMyTurn,
    canOperate,
    selectedCardId,
    selectedTarget,
    discardMin,
    discardMax,
    selectedForDiscard,
    onClearDiscard,
    onConfirmDiscard,
  } = props;

  return (
    <>
      {/* 1. 等待提示 */}
      {!isPerspectiveTurn && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={styles.waitingHint}>等待 {currentPlayerName} 操作...</div>
      )}

      {/* 2. 出牌阶段提示 */}
      {isPerspectiveTurn && view.phase === '出牌' && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={styles.promptBox}>
          <div className={styles.promptTitle}>🃏 {perspectiveName}的回合 — 出牌阶段</div>
          <div className={styles.promptDesc}>
            {canOperate && selectedCardId
              ? selectedTarget
                ? `已选择目标: ${selectedTarget}，点击「出牌」确认`
                : '已选牌，可选择目标或直接出牌'
              : canOperate
                ? '选择一张手牌出牌，或点击「结束回合」'
                : `${perspectiveName} 正在思考...`}
          </div>
        </div>
      )}

      {/* 3. distribute 主动技弹窗(仁德/制衡)已移至 GameView 统一分配面板 */}

      {/* 4. 弃牌阶段提示(自己回合、非 awaiting) */}
      {isPerspectiveTurn && view.phase === '弃牌' && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={styles.promptBox}>
          <div className={styles.promptTitle}>🗑️ {perspectiveName} — 弃牌阶段</div>
          <div className={styles.promptDesc}>{canOperate ? '请弃置多余的手牌' : `${perspectiveName} 正在弃牌...`}</div>
        </div>
      )}

      {/* 5. 弃牌窗口(engine 主动发起的弃牌) */}
      {isDiscardPhase && isPerspectiveAwaiting && (
        <div className={styles.promptBoxAwaiting}>
          <div className={styles.promptTitle}>🗑️ 弃牌阶段:需弃 {discardMin} 张牌（已选 {selectedForDiscard.size}/{discardMin}）</div>
          <div className={styles.promptDesc}>
            {canOperate
              ? discardMin === discardMax
                ? `请选择 ${discardMin} 张手牌弃置`
                : `请选择 ${discardMin}–${discardMax} 张手牌弃置`
              : `等待 ${perspectiveName} 弃牌...`}
          </div>
          {canOperate && (
            <div className={styles.promptActions}>
              <button
                className={styles.promptBtnPrimary}
                disabled={selectedForDiscard.size < discardMin || selectedForDiscard.size > discardMax}
                onClick={onConfirmDiscard}
              >
                确认弃牌 ({selectedForDiscard.size}/{discardMin})
              </button>
              {selectedForDiscard.size > 0 && (
                <button className={styles.promptBtn} onClick={onClearDiscard}>
                  清空选择
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}