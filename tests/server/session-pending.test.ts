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

describe('pending 自动调度（touchAndPersist 内 scheduleTimeout）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(persistence, 'saveRoom').mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('startGame 后自动调度 pending 超时，无需手动 scheduleTimeout', () => {
    const session = new GameSession(room, true);
    session.startGame(2);

    const pending = session.getPending();
    if (!pending) return;

    const s = session as unknown as { timeoutTimer: ReturnType<typeof setTimeout> | null };
    expect(s.timeoutTimer).not.toBeNull();
  });

  it('pending 超时触发后自动 reschedule 下一轮 pending', () => {
    const session = new GameSession(room, true);
    session.startGame(2);

    const s = session as unknown as { timeoutTimer: ReturnType<typeof setTimeout> | null };

    const pendingBefore = session.getPending();
    if (!pendingBefore) return;

    const delay = Math.max(0, pendingBefore.deadline - Date.now());
    vi.advanceTimersByTime(delay + 1);

    const pendingAfter = session.getPending();
    if (pendingAfter && pendingAfter.id !== pendingBefore.id) {
      expect(s.timeoutTimer).not.toBeNull();
    }
  });

  it('连续 handleAction 后 timeout timer 始终被正确设置', () => {
    const mockWs = { send: vi.fn(), close: vi.fn(), readyState: 1 };
    room.players.set('debug-player', mockWs as never);
    const session = new GameSession(room, true);
    session.startGame(2);

    const s = session as unknown as { timeoutTimer: ReturnType<typeof setTimeout> | null };

    const pending = session.getPending();
    if (!pending) return;

    const playerName = session.getPlayerName('debug-player');
    if (!playerName) return;

    session.handleAction('debug-player', { type: 'endTurn', player: playerName });

    const pendingAfter = session.getPending();
    if (pendingAfter) {
      expect(s.timeoutTimer).not.toBeNull();
    }

    room.players.delete('debug-player');
  });

  it('restoreState 后 scheduleTimeout 正常工作', () => {
    vi.spyOn(persistence, 'saveRoom').mockImplementation(async () => {});
    const session1 = new GameSession(room, true);
    session1.startGame(2);
    const json = session1.serializeState();
    expect(json).not.toBeNull();

    const session2 = new GameSession(room, true);
    const ok = session2.deserializeAndRestore(json!);
    expect(ok).toBe(true);

    session2.restoreState(JSON.parse(json!));

    const s = session2 as unknown as { timeoutTimer: ReturnType<typeof setTimeout> | null };
    expect(s.timeoutTimer).not.toBeNull();
  });
});
