// 追加 onView 批次到出牌历史缓冲。
// 禁止整批替换:WS 连发时 React 18 会合并 setState,只留下最后一批(常为「出牌窗口」),打出/弃牌会丢失。

import type { ViewEvent } from '../../engine/types';
import type { QueuedEvent } from '../hooks/useEventPlayback';

/** 已消费事件可裁掉;保留窗口避免缓冲无限增长 */
export const MAX_INGESTED_EVENT_BUFFER = 80;

export function appendIngestedEvents(
  prev: readonly QueuedEvent[],
  newEvents: readonly ViewEvent[],
  nextSeq: () => number,
): QueuedEvent[] {
  if (newEvents.length === 0) return prev.length === 0 ? [] : [...prev];
  const mapped = newEvents.map((event) => ({ seq: nextSeq(), event }));
  const next = prev.length === 0 ? mapped : [...prev, ...mapped];
  if (next.length <= MAX_INGESTED_EVENT_BUFFER) return next;
  return next.slice(next.length - MAX_INGESTED_EVENT_BUFFER);
}
