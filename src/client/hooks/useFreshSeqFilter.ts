// src/client/hooks/useFreshSeqFilter.ts
// seq 去重微 hook:useVfxPlayback / useSoundPlayback / usePlayHistory 共用。
// ingested 批次可能含已处理事件(StrictMode 双跑、同一批次被多个消费者读到),
// seq 单调递增,只需跟踪已处理的最大值(水位)过滤重复。

import { useCallback, useRef } from 'react';
import type { QueuedEvent } from './useEventPlayback';

/**
 * 返回「批次 → 新鲜事件」过滤函数(useCallback 引用稳定,可入 effect deps)。
 * 每次调用过滤掉 seq ≤ 已处理水位的事件并推进水位;过滤结果为空时不推进。
 */
export function useFreshSeqFilter(): (batch: readonly QueuedEvent[]) => QueuedEvent[] {
  const lastSeqRef = useRef(0);
  return useCallback((batch: readonly QueuedEvent[]) => {
    const fresh = batch.filter((e) => e.seq > lastSeqRef.current);
    if (fresh.length > 0) {
      lastSeqRef.current = Math.max(...fresh.map((e) => e.seq));
    }
    return fresh;
  }, []);
}
