// src/client/hooks/useHandReorder.ts
// 手牌拖拽重排 hook。从 GameView.tsx 抽出。
//
// 职责:管理手牌的本地重排顺序(拖拽时实时预览),并在拖拽结束后去抖发送 reorder_hand。
//   - localHandOrder:本地顺序(null = 用服务端顺序;非 null = 本地重排预览)
//   - 一致性校验:服务端手牌变化(摸/出/弃)后,若 localHandOrder 不再合法则自动重置
//   - 同步检测:服务端顺序与本地一致时清除本地状态(避免陈旧覆盖)
//
// 不感知出牌/回应/弃牌等业务逻辑——只管"手牌顺序"这一件事。

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Card } from '../../engine/types';

export interface UseHandReorderResult {
  /** 按本地重排顺序排好的手牌(拖拽预览优先,否则服务端顺序) */
  orderedHand: Card[];
  /** 手牌列表容器 ref(供动画定位用) */
  handleDragStart: (idx: number) => void;
  handleDrop: (targetIdx: number) => void;
}

/**
 * 手牌拖拽重排。
 * @param serverHand      服务端手牌(view.players[perspectiveIdx].hand)
 * @param onReorderHand   拖拽结束后通知上层发送 reorder_hand(可能去抖 400ms)
 */
export function useHandReorder(
  serverHand: Card[],
  onReorderHand?: (order: string[]) => void,
): UseHandReorderResult {
  // null = 用服务端顺序;非 null = 用本地重排顺序(需与服务端手牌集合一致)
  const [localHandOrder, setLocalHandOrder] = useState<string[] | null>(null);
  const dragSrcIdx = useRef<number | null>(null);
  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 本地顺序与服务端手牌集合一致性校验:
  // 服务端手牌变化(摸/出/弃)时,如果 localHandOrder 不再是合法排列,则视为无效。
  const serverHandIds = serverHand.map((c) => c.id);
  const localOrderValid =
    localHandOrder !== null &&
    localHandOrder.length === serverHandIds.length &&
    serverHandIds.every((id) => localHandOrder.includes(id));

  // orderedHand:本地顺序优先(拖拽实时预览),无效则用服务端顺序
  const orderedHand: Card[] = localOrderValid
    ? (localHandOrder.map((id) => serverHand.find((c) => c.id === id)).filter(Boolean) as Card[])
    : serverHand;

  // 服务端已同步本地顺序时,清除本地状态(避免陈旧覆盖);
  // localOrderValid 为 false 时也清除(手牌集合已变)。
  useEffect(() => {
    if (localHandOrder && localOrderValid) {
      const serverOrder = serverHand.map((c) => c.id);
      const synced =
        serverOrder.length === localHandOrder.length &&
        serverOrder.every((id, i) => id === localHandOrder[i]);
      if (synced) setLocalHandOrder(null);
    }
    if (localHandOrder && !localOrderValid) setLocalHandOrder(null);
  }, [localHandOrder, localOrderValid, serverHand]);

  // 拖拽重排:dragstart 记录源位置,drop 时重排
  const handleDragStart = useCallback((idx: number) => {
    dragSrcIdx.current = idx;
  }, []);

  const handleDrop = useCallback(
    (targetIdx: number) => {
      const srcIdx = dragSrcIdx.current;
      dragSrcIdx.current = null;
      if (srcIdx === null || srcIdx === targetIdx) return;
      // 基于当前 orderedHand 重排
      const ids = orderedHand.map((c) => c.id);
      const [moved] = ids.splice(srcIdx, 1);
      ids.splice(targetIdx, 0, moved);
      setLocalHandOrder(ids);
      // 去抖发送 reorder_hand(避免快速拖拽频繁发消息)
      if (onReorderHand) {
        if (reorderTimer.current) clearTimeout(reorderTimer.current);
        reorderTimer.current = setTimeout(() => {
          onReorderHand(ids);
          reorderTimer.current = null;
        }, 400);
      }
    },
    [orderedHand, onReorderHand],
  );

  return { orderedHand, handleDragStart, handleDrop };
}
