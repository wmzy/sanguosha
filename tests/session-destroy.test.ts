import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameSession } from '../server/session';
import * as persistence from '../server/persistence';
import type { Room } from '../server/room';

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

describe('GameSession destroy 阻止后续持久化（race condition 修复）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('destroy 是幂等的，deletePersistedRoom 只调用一次', () => {
    const deleteSpy = vi.spyOn(persistence, 'deletePersistedRoom').mockImplementation(() => {});
    const session = new GameSession(room, true);
    session.destroy();
    session.destroy();
    session.destroy();
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('destroy 后 handleAction 不调用 saveRoom', () => {
    const saveSpy = vi.spyOn(persistence, 'saveRoom').mockImplementation(() => {});
    const session = new GameSession(room, true);
    session.destroy();
    session.handleAction('p1', { type: 'endTurn', player: 'p1' } as never);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('destroy 后 startGame 不调用 saveRoom', () => {
    const saveSpy = vi.spyOn(persistence, 'saveRoom').mockImplementation(() => {});
    const session = new GameSession(room, true);
    session.destroy();
    session.startGame(2);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('destroy 后即便外部强行触发 checkTimeout，也不调用 saveRoom', () => {
    const saveSpy = vi.spyOn(persistence, 'saveRoom').mockImplementation(() => {});
    vi.spyOn(persistence, 'deletePersistedRoom').mockImplementation(() => {});
    const session = new GameSession(room, true);
    session.restoreState(
      {
        pending: {
          id: 'p',
          type: 'playPhase',
          player: 'p1',
          timeout: 1000,
          deadline: Date.now() - 1,
          onTimeout: { type: 'endTurn', player: 'p1' },
        },
      } as never,
      [],
    );
    session.destroy();
    vi.advanceTimersByTime(2000);
    (session as unknown as { checkTimeout: () => void }).checkTimeout();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
