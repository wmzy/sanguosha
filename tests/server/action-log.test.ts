import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameSession } from '../../server/session';
import * as persistence from '../../server/persistence';
import type { Room } from '../../server/room';

const room: Room = {
  id: 'test-room',
  name: 'test',
  players: new Map(),
  maxPlayers: 4,
  status: '进行中',
  hostId: null,
  readyPlayers: new Set(),
  isDebug: true,
};

describe('actionLog 增量追加', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('1000 步追加后 length 和内容正确', () => {
    vi.spyOn(persistence, 'saveRoom').mockImplementation(async () => {});
    const session = new GameSession(room, true);
    session.startGame(2);

    const sessionAny = session as unknown as { appendAction: (action: unknown) => void };
    for (let i = 0; i < 1000; i++) {
      sessionAny.appendAction({ type: '结束回合', player: `P${i}` });
    }

    (session as unknown as { touchAndPersist: () => void }).touchAndPersist();
    const lastLog = vi.mocked(persistence.saveRoom).mock.calls.at(-1)![3] as unknown[];

    expect(lastLog).toHaveLength(1001);
    expect(lastLog[0]).toEqual({ type: '开始' });
    expect(lastLog[500]).toEqual({ type: '结束回合', player: 'P499' });
    expect(lastLog[1000]).toEqual({ type: '结束回合', player: 'P999' });
  });

  it('push 保持同一数组引用（O(1) 而非 O(n) 重建）', () => {
    vi.spyOn(persistence, 'saveRoom').mockImplementation(async () => {});
    const session = new GameSession(room, true);
    session.startGame(2);

    const sessionAny = session as unknown as {
      appendAction: (action: unknown) => void;
      actionLog: unknown[];
    };

    const refBefore = sessionAny.actionLog;
    sessionAny.appendAction({ type: '结束回合', player: 'P1' });
    const refAfter = sessionAny.actionLog;

    expect(refBefore).toBe(refAfter);
    expect(sessionAny.actionLog).toHaveLength(2);
  });

  it('1000 步连续追加 < 100ms', () => {
    vi.useRealTimers();
    vi.spyOn(persistence, 'saveRoom').mockImplementation(async () => {});

    const session = new GameSession(room, true);
    session.startGame(2);
    const sessionAny = session as unknown as { appendAction: (action: unknown) => void };

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      sessionAny.appendAction({ type: '结束回合', player: `P${i}` });
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    vi.useFakeTimers();
  });
});
