// src/client/hooks/usePlayInteraction/discard.ts
// 弃牌阶段交互子 hook(从 usePlayInteraction.ts 拆出,纯结构搬运)。
// 职责:
//   - 弃牌多选状态 selectedForDiscard(有序数组,FIFO 淘汰依赖此顺序)
//   - pending 切换时的重置 effect
//   - 确认弃牌 / 全选 / 反选 / 清空
//   - handleRespond 在弃牌窗口的分支:选中张数够 → 确认提交;不足 → 兜底提交手牌末 N 张
// 不管理:出牌选中(selectedCardId)、回应选牌(见 respond.ts)。

import { useCallback, useEffect, useState } from 'react';
import type { Card, PendingView } from '../../../engine/types';
import type { PendingRespondInfo } from '../../utils/pendingRespond';
import type { PlaySend } from './common';
import { invertOrdered, selectAllOrdered, toggleOrderedFifo } from './orderedSelection';

export interface DiscardInteractionParams {
  /** pending 原始对象(可能 null) */
  pending: PendingView | null;
  /** 是否弃牌窗口 */
  isDiscardPhase: boolean;
  /** 弃牌窗口最少/最多张数 */
  discardMin: number;
  discardMax: number;
  /** 当前视角手牌 */
  perspectiveHand: Card[];
  /** 已 resolve 的 respond 信息(usePendingState memo 后传入) */
  pendingRespondInfo: PendingRespondInfo | null;
  /** 发送 action 的底层函数(GameView 的 send) */
  send: PlaySend;
}

export interface DiscardInteraction {
  /** 弃牌阶段多选(有序数组,插入顺序;FIFO 淘汰依赖此顺序) */
  selectedForDiscard: string[];
  /** 弃牌窗口点牌 toggle(外壳 handleCardClick 的弃牌分支) */
  toggleDiscardCard: (cardId: string) => void;
  handleConfirmDiscard: () => void;
  /** handleRespond 的 isDiscardPhase 分支:选中够了走确认,不够走兜底(手牌末 discardMin 张) */
  respondInDiscardWindow: () => void;
  /** 弃牌阶段:全选(截断到 discardMax) */
  handleDiscardSelectAll: () => void;
  /** 弃牌阶段:反选(超 discardMax 时按 FIFO 取尾部) */
  handleDiscardInvert: () => void;
  clearDiscard: () => void;
}

export function useDiscardInteraction(p: DiscardInteractionParams): DiscardInteraction {
  const { pending, isDiscardPhase, discardMin, discardMax, perspectiveHand, pendingRespondInfo, send } = p;

  // 弃牌阶段多选:有序数组(插入顺序),用于 FIFO 淘汰(选满 max 后再选自动取消最早那张)。
  const [selectedForDiscard, setSelectedForDiscard] = useState<string[]>([]);

  // state 重置 effect(随迁):pending 变化清空弃牌多选
  useEffect(() => {
    setSelectedForDiscard([]);
  }, [pending]);

  /** 弃牌窗口点牌 toggle(外壳 handleCardClick 的弃牌分支原样搬入)。 */
  const toggleDiscardCard = useCallback(
    (cardId: string) => {
      setSelectedForDiscard((prev) => toggleOrderedFifo(prev, cardId, discardMax));
    },
    [discardMax],
  );

  const handleConfirmDiscard = useCallback(() => {
    if (!pending || !isDiscardPhase) return;
    if (selectedForDiscard.length < discardMin || selectedForDiscard.length > discardMax) return;
    const cardIds = selectedForDiscard;
    // 系统弃牌阶段 → '系统规则';强制型技能弃牌(英魂) → pendingRespondInfo.skillId
    const skillId = pendingRespondInfo?.skillId ?? '系统规则';
    send(skillId, 'respond', { cardIds });
    setSelectedForDiscard([]);
  }, [
    pending,
    isDiscardPhase,
    selectedForDiscard,
    discardMin,
    discardMax,
    send,
    pendingRespondInfo,
  ]);

  /** handleRespond 的弃牌窗口分支(原样搬入):选中张数 ≥ discardMin 走确认;
   *  不足时兜底提交手牌末 discardMin 张(超时自动弃牌同路径)。 */
  const respondInDiscardWindow = useCallback(() => {
    if (selectedForDiscard.length >= discardMin) {
      handleConfirmDiscard();
    } else {
      const hand = perspectiveHand;
      const fallback = hand.slice(-discardMin).map((c) => c.id);
      const skillId = pendingRespondInfo?.skillId ?? '系统规则';
      send(skillId, 'respond', { cardIds: fallback });
      setSelectedForDiscard([]);
    }
  }, [selectedForDiscard, discardMin, handleConfirmDiscard, perspectiveHand, pendingRespondInfo, send]);

  // ─── 多选快捷:全选 / 反选(弃牌阶段;转化/distribute 的同款见各自子 hook) ───
  // 弃牌阶段候选=整手牌;受 discardMax 截断。
  const handleDiscardSelectAll = useCallback(() => {
    setSelectedForDiscard(
      selectAllOrdered(
        perspectiveHand.map((c) => c.id),
        discardMax,
      ),
    );
  }, [perspectiveHand, discardMax]);

  const handleDiscardInvert = useCallback(() => {
    setSelectedForDiscard((prev) =>
      invertOrdered(
        perspectiveHand.map((c) => c.id),
        prev,
        discardMax,
      ),
    );
  }, [perspectiveHand, discardMax]);

  const clearDiscard = useCallback(() => setSelectedForDiscard([]), []);

  return {
    selectedForDiscard,
    toggleDiscardCard,
    handleConfirmDiscard,
    respondInDiscardWindow,
    handleDiscardSelectAll,
    handleDiscardInvert,
    clearDiscard,
  };
}
