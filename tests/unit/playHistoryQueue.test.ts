import { describe, expect, it } from 'vitest';
import {
  MAX_PLAY_HISTORY,
  PLAY_HISTORY_TTL_MS,
  expirePlayHistory,
  pushPlayHistory,
  updatePlayHistoryCaption,
  type PlayHistoryItem,
} from '../../src/client/utils/playHistoryQueue';

function item(partial: Partial<PlayHistoryItem> & { id: string }): PlayHistoryItem {
  return {
    card: { name: '杀', suit: '♠', rank: '7' },
    caption: 'P0',
    enqueuedAt: 0,
    ...partial,
  };
}

describe('playHistoryQueue', () => {
  it('pushes newest to the end (FIFO display left→right oldest→newest)', () => {
    const a = item({ id: 'a', enqueuedAt: 1 });
    const b = item({ id: 'b', enqueuedAt: 2 });
    const next = pushPlayHistory(pushPlayHistory([], a), b);
    expect(next.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('drops oldest when exceeding max length 30', () => {
    let q: PlayHistoryItem[] = [];
    for (let i = 0; i < MAX_PLAY_HISTORY + 5; i++) {
      q = pushPlayHistory(q, item({ id: `i${i}`, enqueuedAt: i }));
    }
    expect(q).toHaveLength(MAX_PLAY_HISTORY);
    expect(q[0].id).toBe('i5');
    expect(q[q.length - 1].id).toBe(`i${MAX_PLAY_HISTORY + 4}`);
  });

  it('expires items older than 5s', () => {
    const now = 10_000;
    const q = [
      item({ id: 'old', enqueuedAt: now - PLAY_HISTORY_TTL_MS - 1 }),
      item({ id: 'keep', enqueuedAt: now - 100 }),
    ];
    expect(expirePlayHistory(q, now).map((x) => x.id)).toEqual(['keep']);
  });

  it('updates caption by cardId when target is resolved', () => {
    const q = [item({ id: '1', cardId: 'c1', caption: '刘备' })];
    const next = updatePlayHistoryCaption(q, 'c1', '刘备→张角');
    expect(next[0].caption).toBe('刘备→张角');
  });
});
