// src/client/hooks/usePlayHistory.ts
// 出牌历史队列:消费 onView 下发的 newEvents 批次(使用时立即入条)。

import { useEffect, useRef, useState } from 'react';
import type { GameView } from '../../engine/types';
import type { QueuedEvent } from './useEventPlayback';
import { useFreshSeqFilter } from './useFreshSeqFilter';
import {
  expirePlayHistory,
  pushPlayHistory,
  updatePlayHistoryCaption,
  type PlayHistoryItem,
} from '../utils/playHistoryQueue';
import { playHistoryMutationFromEvent } from '../utils/playHistoryFromEvent';

export function usePlayHistory(
  ingested: readonly QueuedEvent[] | null | undefined,
  view: GameView,
): PlayHistoryItem[] {
  const [items, setItems] = useState<PlayHistoryItem[]>([]);
  const filterFresh = useFreshSeqFilter();
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!ingested || ingested.length === 0) return;
    // seq 去重(共享水位过滤,见 useFreshSeqFilter)
    const fresh = filterFresh(ingested);
    if (fresh.length === 0) return;

    setItems((prev) => {
      const now = Date.now();
      let next = expirePlayHistory(prev, now);
      for (const q of fresh) {
        const mutation = playHistoryMutationFromEvent(q.event, viewRef.current, now);
        if (!mutation) continue;
        if (mutation.kind === 'push') {
          next = mutation.items.reduce((acc, it) => pushPlayHistory(acc, it), next);
        } else {
          next = updatePlayHistoryCaption(next, mutation.cardId, mutation.caption);
        }
      }
      return next;
    });
  }, [ingested, filterFresh]);

  useEffect(() => {
    if (items.length === 0) return;
    const id = setInterval(() => {
      setItems((prev) => {
        const next = expirePlayHistory(prev, Date.now());
        return next.length === prev.length ? prev : next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [items.length]);

  return items;
}
