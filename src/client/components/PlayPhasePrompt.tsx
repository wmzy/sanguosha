// src/client/components/PlayPhasePrompt.tsx
// 纯展示组件:出牌/distribute/弃牌 5 个并列提示块,逐字迁移自 GameView.tsx 662-746 行。
// 不持有任何业务状态,所有数据/回调由 props 传入。
// 共享数据(view/perspectiveName/canOperate)来自 GameViewCtx,专属数据仍走 props。
// 为保留 memo comparator 采用「context 消费壳 + 内部 memo impl」模式:壳取共享字段
// 转发给保持原 comparator 的 memo impl(原 perspectiveIdx/perspectiveHand props 已废弃删除)。

import { memo } from 'react';
import * as styles from './gameViewStyles';
import type { GameView, PendingView } from '../../engine/types';
import { viewSlashMax, viewSlashUsed } from '../../engine/rules/action-active';
import { getPendingRequestType } from '../utils/pendingRespond';
import { useGameView } from './GameViewCtx';

/** 当前回合玩家的杀次数徽标文案(纯函数,渲染与 memo 比较共用)。
 *  数据源:view.players[currentPlayerIndex].turnUsage(「回合用量」atom 实时投影,
 *  回合结束整体清空)。上限推断复用引擎 viewSlashMax(与后端 slashMax 同源:
 *  诸葛连弩武器元数据 / '杀/unlimited/<来源>' 前缀任一真值 → ∞;'杀/extra/' 叠加)。
 *  turnUsage 缺失(旧 view / 异常数据)时返回 null 不渲染,数字读取均有 typeof 兜底。 */
function slashCountBadgeText(view: GameView): string | null {
  const idx = view.currentPlayerIndex;
  const p = view.players[idx];
  if (!p || !p.turnUsage) return null;
  const max = viewSlashMax(view, idx);
  if (max === Infinity) return '杀 ∞';
  return `杀 ${viewSlashUsed(view, idx)}/${max}`;
}

/** 从 pending 推导询问类型短语(观察者视角文案用):
 *  询问闪/询问杀 → 闪/杀;'__弃牌' → 弃牌;'杀/respondKill'、'从谏/给牌' 等
 *  带分隔符的 requestType → 取主名(杀/从谏)。推不出返回 null。 */
function pendingAskLabel(pending: PendingView): string | null {
  const atomType = pending.atom?.type;
  if (typeof atomType === 'string' && atomType.startsWith('询问')) {
    return atomType.slice(2) || null;
  }
  const reqType = getPendingRequestType(pending);
  if (!reqType) return null;
  if (reqType === '__弃牌') return '弃牌';
  const main = reqType.split(/[/_]/)[0];
  return main || null;
}

/** 等待提示的「被询问者」文案(纯函数,渲染与 memo 比较共用)。
 *  数据源 view.pending(事件流模式下 applyView 对所有 viewer 投影:非 target
 *  视角同样携带 atom.requestType/target,见 询问杀/请求回应 的 applyView)。
 *  pending 指向非当前回合玩家时返回「等待 {targetName} 回应{询问类型}」,
 *  如南蛮入侵询问张飞出杀时旁观者看到「等待 张飞 回应杀...」而非误导性的回合主人。
 *  返回 null(维持原文案「等待 {currentPlayerName} 操作...」)的情形:
 *  - 无 pending / 非阻塞型 pending(出牌窗口是控制权 token,不是询问);
 *  - target 为 null(防御旧数据)或广播型(target<0,如无懈可击)——不指定具体座次;
 *  - target 即当前回合玩家(等他出牌,原文案语义正确);
 *  - view.players[target] 缺失(异常数据)。
 *  注意座号 0 是合法座次:只用 nullish/负数判断,不能用 truthy。 */
function waitingRespondText(view: GameView): string | null {
  const pending = view.pending;
  if (!pending || pending.isBlocking === false) return null;
  // PendingView.target 类型为 number,但旧数据/异常投影可能缺省——nullish 兜底
  const target = (pending as { target?: number | null }).target ?? null;
  if (target === null || target < 0) return null;
  if (target === view.currentPlayerIndex) return null;
  const name = view.players[target]?.name;
  if (!name) return null;
  const label = pendingAskLabel(pending);
  return `等待 ${name} ${label ? `回应${label}` : '回应'}...`;
}

export interface PlayPhasePromptProps {
  currentPlayerName: string;
  isPerspectiveTurn: boolean;
  isPerspectiveAwaiting: boolean;
  isDiscardPhase: boolean;
  isMyTurn: boolean;
  selectedCardId: string | null;
  selectedTarget: string | null;
  discardMin: number;
  discardMax: number;
  selectedForDiscard: string[];
}

/** 内部 memo impl 的 props(含从 context 转发下来的共享字段)。 */
interface PlayPhasePromptImplProps extends PlayPhasePromptProps {
  view: GameView;
  perspectiveName: string;
  canOperate: boolean;
}

export function PlayPhasePromptImpl(props: PlayPhasePromptImplProps) {
  const {
    view,
    perspectiveName,
    currentPlayerName,
    isPerspectiveTurn,
    isPerspectiveAwaiting,
    isDiscardPhase,
    isMyTurn: _isMyTurn,
    canOperate,
    selectedCardId,
    selectedTarget,
    discardMin,
    discardMax,
    selectedForDiscard,
  } = props;

  // 出牌阶段标题行的杀次数徽标(数据缺失为 null,渲染端跳过)
  const slashBadgeText = slashCountBadgeText(view);
  // 被询问者等待文案(pending 指向他人时替换「等待 回合主人 操作...」)
  const respondWaitText = waitingRespondText(view);

  return (
    <>
      {/* 1. 等待提示 */}
      {!isPerspectiveTurn && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={styles.waitingHint}>
          {respondWaitText ?? `等待 ${currentPlayerName} 操作...`}
        </div>
      )}

      {/* 2. 出牌阶段提示 */}
      {isPerspectiveTurn && view.phase === '出牌' && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={styles.promptBox}>
          <div className={styles.promptTitle}>
            🃏 {perspectiveName}的回合 — 出牌阶段
            {slashBadgeText !== null && (
              <span className={styles.slashCountBadge} title="本回合【杀】已用次数/上限（无限杀生效时显示 ∞）">
                ⚔️ {slashBadgeText}
              </span>
            )}
          </div>
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
          <div className={styles.promptDesc}>
            {canOperate ? '请弃置多余的手牌' : `${perspectiveName} 正在弃牌...`}
          </div>
        </div>
      )}

      {/* 5. 弃牌窗口(engine 主动发起的弃牌) */}
      {isDiscardPhase && isPerspectiveAwaiting && (
        <div className={styles.promptBoxAwaiting}>
          <div className={styles.promptTitle}>
            🗑️ 弃牌阶段:需弃 {discardMin} 张牌（已选 {selectedForDiscard.length}/{discardMin}）
          </div>
          <div className={styles.promptDesc}>
            {canOperate
              ? discardMin === discardMax
                ? `请选择 ${discardMin} 张手牌弃置`
                : `请选择 ${discardMin}–${discardMax} 张手牌弃置`
              : `等待 ${perspectiveName} 弃牌...`}
          </div>
        </div>
      )}
    </>
  );
}

/** memo: 纯展示提示块,只在相关 primitive props / phase 变化时重渲染 */
function playPhasePromptPropsEqual(
  prev: PlayPhasePromptImplProps,
  next: PlayPhasePromptImplProps,
): boolean {
  return (
    prev.view.phase === next.view.phase &&
    prev.perspectiveName === next.perspectiveName &&
    prev.currentPlayerName === next.currentPlayerName &&
    prev.isPerspectiveTurn === next.isPerspectiveTurn &&
    prev.isPerspectiveAwaiting === next.isPerspectiveAwaiting &&
    prev.isDiscardPhase === next.isDiscardPhase &&
    prev.canOperate === next.canOperate &&
    prev.selectedCardId === next.selectedCardId &&
    prev.selectedTarget === next.selectedTarget &&
    prev.discardMin === next.discardMin &&
    prev.discardMax === next.discardMax &&
    prev.selectedForDiscard.length === next.selectedForDiscard.length &&
    slashCountBadgeText(prev.view) === slashCountBadgeText(next.view) &&
    waitingRespondText(prev.view) === waitingRespondText(next.view)
  );
}

const PlayPhasePromptMemo = memo(PlayPhasePromptImpl, playPhasePromptPropsEqual);

/** context 消费壳:共享数据(view/perspectiveName/canOperate)来自 GameViewCtx,
 *  转发给保持原 comparator 的 memo impl。 */
export function PlayPhasePrompt(props: PlayPhasePromptProps) {
  const { view, perspectiveName, canOperate } = useGameView();
  return <PlayPhasePromptMemo {...props} view={view} perspectiveName={perspectiveName} canOperate={canOperate} />;
}
