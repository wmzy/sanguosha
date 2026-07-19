// src/client/utils/playHistoryQueue.ts
// 对战区中央「出牌历史」FIFO 队列纯逻辑(无 React)。
// 规则:最多 30 张;每张最多存活 5s;新牌入队尾,超长丢队头。

export const MAX_PLAY_HISTORY = 30;
export const PLAY_HISTORY_TTL_MS = 5000;

export type PlayHistoryCard = {
  name: string;
  suit?: string;
  rank?: string;
};

export type PlayHistoryItem = {
  id: string;
  card: PlayHistoryCard;
  /** 短标注:刘备→张角 / 刘备弃 / 张角出闪 */
  caption: string;
  enqueuedAt: number;
  cardId?: string;
};

/** 入队:追加到队尾;超过上限丢弃最旧。 */
export function pushPlayHistory(
  items: readonly PlayHistoryItem[],
  item: PlayHistoryItem,
): PlayHistoryItem[] {
  const next = [...items, item];
  if (next.length <= MAX_PLAY_HISTORY) return next;
  return next.slice(next.length - MAX_PLAY_HISTORY);
}

/** 清除存活超过 TTL 的项。 */
export function expirePlayHistory(
  items: readonly PlayHistoryItem[],
  now: number,
): PlayHistoryItem[] {
  return items.filter((x) => now - x.enqueuedAt <= PLAY_HISTORY_TTL_MS);
}

/** 按 cardId 更新标注(打出后指定目标时补全 源→目标)。 */
export function updatePlayHistoryCaption(
  items: readonly PlayHistoryItem[],
  cardId: string,
  caption: string,
): PlayHistoryItem[] {
  let changed = false;
  const next = items.map((x) => {
    if (x.cardId !== cardId) return x;
    changed = true;
    return { ...x, caption };
  });
  return changed ? next : [...items];
}
