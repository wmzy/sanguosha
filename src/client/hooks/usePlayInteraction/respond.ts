// src/client/hooks/usePlayInteraction/respond.ts
// 回应窗口交互子 hook(从 usePlayInteraction.ts 拆出,纯结构搬运)。
// 职责:
//   - useCard 类回应选牌状态 selectedRespondCardId(选+「打出」两步式,防误触)
//   - useCardAndTarget 类回应(借刀杀人/出杀)目标状态 respondTargets
//   - pending 切换时的重置 effect;respond 模式派生(目标过滤/是否需目标/就绪判定)
//   - handleRespond / handlePlayRespond / clearRespondSelection
//   - 回应窗口的点牌、双击、点目标分支(外壳 dispatcher 委托)
// 与出牌阶段 selectedTarget/selectedUseAction 是两套独立交互,互不复用。

import { useCallback, useEffect, useState } from 'react';
import type { Card, GameView, PendingView, TargetFilter } from '../../../engine/types';
import type { PendingRespondInfo } from '../../utils/pendingRespond';
import { toggleTargetSelection, validateTargetSelection } from '../../../engine/rules/target-selection';
import type { PlaySend } from './common';

export interface RespondInteractionParams {
  view: GameView;
  perspectiveIdx: number;
  perspectiveHand: Card[];
  /** pending 原始对象(可能 null) */
  pending: PendingView | null;
  /** 是否当前视角在等待回应(阻塞型)且可操作(isPerspectiveAwaiting && canOperate) */
  isMyAwaiting: boolean;
  /** 是否弃牌窗口(弃牌窗口的回应走 discard 子 hook 的确认/兜底) */
  isDiscardPhase: boolean;
  /** 已 resolve 的 respond 信息(usePendingState memo 后传入) */
  pendingRespondInfo: PendingRespondInfo | null;
  /** pending target 座次 */
  pendingTargetIdx: number;
  /** 广播型 pending 的去重 key */
  broadcastKey: string;
  /** 广播跳过标记函数(usePendingState 提供) */
  markBroadcastSkipped: (key: string) => void;
  /** 发送 action 的底层函数(GameView 的 send) */
  send: PlaySend;
  /** handleRespond 的弃牌窗口分支(discard 子 hook 的 respondInDiscardWindow) */
  discardRespond: () => void;
}

export interface RespondInteraction {
  /** useCard 类回应选中的牌 id(点牌选中,再点「打出」出牌);非回应窗口为 null */
  selectedRespondCardId: string | null;
  /** useCardAndTarget 类回应(借刀杀人/出杀)选中的目标座次 name;非此模式为 null */
  respondTargetName: string | null;
  respondTargets: number[];
  /** respond 模式目标过滤(pending.prompt.targetFilter 投影;非 useCardAndTarget 回应为 null) */
  respondTargetFilter: TargetFilter | null;
  /** 当前回应是否需要选目标(useCardAndTarget 且非 selfTarget) */
  respondNeedsTarget: boolean;
  /** 选中的回应牌(校验目标约束的 card 参数) */
  respondCard: Card | undefined;
  /** respond 目标是否已满足(选了牌 + 选了目标) */
  respondTargetReady: boolean;
  handleRespond: (cardId?: string) => void;
  /** useCard 类回应「打出」按钮:用选中的回应牌出牌 */
  handlePlayRespond: () => void;
  /** 清空回应选牌/换目标(Esc 快捷键用):与 pending 切换自动清空同一对 setter */
  clearRespondSelection: () => void;
  /** 回应窗口点牌(外壳 handleCardClick 的回应分支):只选中高亮,不直接出牌 */
  handleCardClick: (card: Card) => void;
  /** 回应窗口双击(外壳 handleCardDoubleClick 的回应分支):可回应牌直接打出 */
  handleCardDoubleClick: (card: Card) => void;
  /** 回应窗口点座位(外壳 handleTargetClick 的回应分支):toggle 目标选中 */
  toggleSeatTarget: (idx: number) => void;
}

export function useRespondInteraction(p: RespondInteractionParams): RespondInteraction {
  const {
    view,
    perspectiveIdx,
    perspectiveHand,
    pending,
    isMyAwaiting,
    isDiscardPhase,
    pendingRespondInfo,
    pendingTargetIdx,
    broadcastKey,
    markBroadcastSkipped,
    send,
    discardRespond,
  } = p;

  // useCard 类回应(被杀出闪/求桃/无懈可击等):先选牌(高亮)再点「打出」确认,避免误触直接出牌。
  // 与弃牌阶段 selectedForDiscard 同为「选+确认」两步式,但只选一张。
  const [selectedRespondCardId, setSelectedRespondCardId] = useState<string | null>(null);
  // useCardAndTarget 类回应(借刀杀人/出杀):选中杀牌后再选目标座次,满足后「打出」可提交。
  // respond 模式独立于出牌阶段的 selectedTarget,避免与出牌选牌状态互相干扰。
  const [respondTargets, setRespondTargets] = useState<number[]>([]);

  // 询问窗口切换/打出后/不回应后:pending 变化驱动清空回应选牌(与弃牌多选同源)。
  useEffect(() => {
    setSelectedRespondCardId(null);
    setRespondTargets([]);
  }, [pending]);

  // ─── respond 模式派生(useCardAndTarget 类回应,如借刀杀人/出杀)───
  // respondTargetFilter 来自 pending.prompt.targetFilter(经投影层下发);无 filter 时
  // 前端以「其他存活玩家」作 UI 提示,后端 validate 权威校验距离/必含等约束。
  const respondTargetFilter =
    isMyAwaiting && pending?.prompt?.type === 'useCardAndTarget'
      ? pending.prompt.targetFilter
      : null;
  const respondNeedsTarget =
    isMyAwaiting && pending?.prompt?.type === 'useCardAndTarget' && !pending.prompt.selfTarget;
  const respondCard = perspectiveHand.find((card) => card.id === selectedRespondCardId);
  const respondTargetReady = !respondNeedsTarget || (!!respondTargetFilter &&
    validateTargetSelection(view, perspectiveIdx, respondTargetFilter, respondTargets, respondCard));
  const respondTargetName =
    respondTargets.map((index) => view.players[index]?.name).filter(Boolean).join('、') || null;

  const handleRespond = useCallback(
    (cardId?: string) => {
      if (!pending) return;
      if (isDiscardPhase) {
        // 弃牌窗口:确认/兜底提交的状态与逻辑归 discard 子 hook(selectedForDiscard 随迁)
        discardRespond();
        return;
      }
      const info = pendingRespondInfo;
      if (!info) return;
      if (cardId) {
        const card = perspectiveHand.find((c) => c.id === cardId);
        if (!card) return;
        if (info.cardFilter && !info.cardFilter(card)) return;
        // 求桃:按救援牌路由到对应技能(桃/酒/急救);其他回应用默认 skillId
        const rescueSkill = info.rescueSkillForCard?.(card);
        // useCardAndTarget 类回应：目标数组经共享约束解释器校验并原样提交。
        if (respondNeedsTarget && respondTargetFilter) {
          if (!validateTargetSelection(view, perspectiveIdx, respondTargetFilter, respondTargets, card)) return;
          send(rescueSkill ?? info.skillId, 'respond', { cardId, targets: respondTargets });
        } else {
          send(rescueSkill ?? info.skillId, 'respond', { cardId });
        }
      } else if (pendingTargetIdx < 0) {
        // 广播型 pending(无懈可击):发 skip 让服务端累计,全员 skip 时提前结束窗口
        send('__skip', 'skip', {});
        markBroadcastSkipped(broadcastKey);
      } else {
        send(info.skillId, 'respond', {});
      }
    },
    [
      pending,
      isDiscardPhase,
      discardRespond,
      perspectiveHand,
      pendingRespondInfo,
      respondNeedsTarget,
      respondTargetFilter,
      respondTargets,
      perspectiveIdx,
      view,
      send,
      pendingTargetIdx,
      markBroadcastSkipped,
      broadcastKey,
    ],
  );

  // useCard/useCardAndTarget 类回应「打出」按钮:用当前选中的回应牌发起 respond。
  // useCardAndTarget(借刀杀人/出杀)还需已选目标(respondTargetReady)。
  const handlePlayRespond = useCallback(() => {
    if (!selectedRespondCardId) return;
    if (!respondTargetReady) return;
    const cardId = selectedRespondCardId;
    setSelectedRespondCardId(null);
    setRespondTargets([]);
    handleRespond(cardId);
  }, [selectedRespondCardId, respondTargetReady, handleRespond]);

  const clearRespondSelection = useCallback(() => {
    setSelectedRespondCardId(null);
    setRespondTargets([]);
  }, []);

  /** 回应窗口点牌(外壳 handleCardClick 的回应分支原样搬入):
   *  点牌只选中(高亮),不直接出牌;再点同一张取消选中。
   *  真正出牌由「打出」按钮(handlePlayRespond)触发,避免误触。求桃/无懈可击同此路径。 */
  const handleCardClick = useCallback(
    (card: Card) => {
      if (pendingRespondInfo?.cardFilter) {
        if (pendingRespondInfo.cardFilter(card)) {
          setSelectedRespondCardId((prev) => (prev === card.id ? null : card.id));
        }
      }
    },
    [pendingRespondInfo],
  );

  /** 回应窗口双击(外壳 handleCardDoubleClick 的回应分支原样搬入):
   *  可回应牌双击直接打出;需目标的(借刀杀人出杀)退化为选中,仍需点目标+「打出」。
   *  转化回应路径的拦截由外壳 `if (transformMode) return` 承担。 */
  const handleCardDoubleClick = useCallback(
    (card: Card) => {
      if (!pendingRespondInfo?.cardFilter?.(card)) return;
      if (respondNeedsTarget) {
        setSelectedRespondCardId(card.id);
        return;
      }
      setSelectedRespondCardId(null);
      handleRespond(card.id);
    },
    [pendingRespondInfo, respondNeedsTarget, handleRespond],
  );

  /** 回应窗口点座位(外壳 handleTargetClick 的回应分支原样搬入):
   *  useCardAndTarget(借刀杀人/出杀)点目标 toggle 选中,与出牌阶段 selectedTarget 独立。
   *  不依赖 selectedCardId/selectedUseAction(respond 时两者均空),直接操作 respondTargets。 */
  const toggleSeatTarget = useCallback(
    (idx: number) => {
      if (!respondTargetFilter) return;
      setRespondTargets((previous) =>
        toggleTargetSelection(view, perspectiveIdx, respondTargetFilter, previous, idx, respondCard),
      );
    },
    [view, perspectiveIdx, respondTargetFilter, respondCard],
  );

  return {
    selectedRespondCardId,
    respondTargetName,
    respondTargets,
    respondTargetFilter,
    respondNeedsTarget,
    respondCard,
    respondTargetReady,
    handleRespond,
    handlePlayRespond,
    clearRespondSelection,
    handleCardClick,
    handleCardDoubleClick,
    toggleSeatTarget,
  };
}
