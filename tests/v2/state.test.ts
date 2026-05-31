/**
 * tests/v2/state.test.ts — 状态管理函数
 */
import { describe, it, expect } from 'vitest';
import {
  getPlayer,
  getAlivePlayers,
  getAlivePlayerNames,
  getCard,
  updatePlayer,
  updatePlayers,
  nextRngState,
} from '@engine/v2/state';
import { createTestGame } from './setup';

describe('getPlayer', () => {
  it('returns the correct player', () => {
    const state = createTestGame();
    const p = getPlayer(state, 'P1');
    expect(p.info.name).toBe('P1');
  });

  it('returns undefined for unknown player', () => {
    const state = createTestGame();
    expect(getPlayer(state, 'Unknown')).toBeUndefined();
  });
});

describe('getAlivePlayers', () => {
  it('returns all players when all alive', () => {
    const state = createTestGame();
    expect(getAlivePlayers(state)).toHaveLength(2);
  });

  it('filters out dead players', () => {
    const state = createTestGame();
    state.players.P2.info.alive = false;
    const alive = getAlivePlayers(state);
    expect(alive).toHaveLength(1);
    expect(alive[0].info.name).toBe('P1');
  });

  it('preserves playerOrder ordering', () => {
    const state = createTestGame({ playerCount: 3 });
    const names = getAlivePlayers(state).map(p => p.info.name);
    expect(names).toEqual(['P1', 'P2', 'P3']);
  });

  it('returns empty when all dead', () => {
    const state = createTestGame();
    state.players.P1.info.alive = false;
    state.players.P2.info.alive = false;
    expect(getAlivePlayers(state)).toHaveLength(0);
  });
});

describe('getAlivePlayerNames', () => {
  it('returns string names of alive players', () => {
    const state = createTestGame();
    expect(getAlivePlayerNames(state)).toEqual(['P1', 'P2']);
  });

  it('skips dead players', () => {
    const state = createTestGame();
    state.players.P1.info.alive = false;
    expect(getAlivePlayerNames(state)).toEqual(['P2']);
  });
});

describe('getCard', () => {
  it('returns the card for a valid ID', () => {
    const state = createTestGame();
    const cardId = state.players.P1.hand[0];
    const card = getCard(state, cardId);
    expect(card).toBeDefined();
    expect(card.id).toBe(cardId);
  });

  it('returns undefined for unknown card ID', () => {
    const state = createTestGame();
    expect(getCard(state, 'nonexistent')).toBeUndefined();
  });
});

describe('updatePlayer', () => {
  it('applies partial update', () => {
    const state = createTestGame();
    const updated = updatePlayer(state, 'P1', p => ({ health: p.health - 1 }));
    expect(updated.players.P1.health).toBe(state.players.P1.health - 1);
  });

  it('does not mutate original state', () => {
    const state = createTestGame();
    const originalHealth = state.players.P1.health;
    updatePlayer(state, 'P1', () => ({ health: 0 }));
    expect(state.players.P1.health).toBe(originalHealth);
  });

  it('only changes the targeted player', () => {
    const state = createTestGame();
    const p2HealthBefore = state.players.P2.health;
    const updated = updatePlayer(state, 'P1', () => ({ health: 1 }));
    expect(updated.players.P2.health).toBe(p2HealthBefore);
  });

  it('preserves other player properties', () => {
    const state = createTestGame();
    const originalHand = [...state.players.P1.hand];
    const updated = updatePlayer(state, 'P1', () => ({ health: 1 }));
    expect(updated.players.P1.hand).toEqual(originalHand);
  });
});

describe('updatePlayers', () => {
  it('updates multiple players atomically', () => {
    const state = createTestGame();
    const updated = updatePlayers(state, {
      P1: { health: 1 },
      P2: { health: 2 },
    });
    expect(updated.players.P1.health).toBe(1);
    expect(updated.players.P2.health).toBe(2);
  });

  it('does not mutate original state', () => {
    const state = createTestGame();
    const p1Health = state.players.P1.health;
    const p2Health = state.players.P2.health;
    updatePlayers(state, { P1: { health: 0 }, P2: { health: 0 } });
    expect(state.players.P1.health).toBe(p1Health);
    expect(state.players.P2.health).toBe(p2Health);
  });

  it('does not affect unlisted players', () => {
    const state = createTestGame({ playerCount: 3 });
    const p3Health = state.players.P3.health;
    const updated = updatePlayers(state, { P1: { health: 1 }, P2: { health: 2 } });
    expect(updated.players.P3.health).toBe(p3Health);
  });
});

describe('nextRngState', () => {
  it('returns a new state with incremented rngState', () => {
    const state = createTestGame();
    const { state: newState } = nextRngState(state);
    expect(newState.rngState).toBe(state.rngState + 1);
  });

  it('does not mutate original state', () => {
    const state = createTestGame();
    const originalRng = state.rngState;
    nextRngState(state);
    expect(state.rngState).toBe(originalRng);
  });

  it('returns a working rng', () => {
    const state = createTestGame();
    const { rng } = nextRngState(state);
    const a = rng.nextInt(100);
    const b = rng.nextInt(100);
    expect(a).not.toBe(b);
  });

  it('produces deterministic sequences for same seed', () => {
    const state = createTestGame();
    const { rng: rng1 } = nextRngState(state);
    const { rng: rng2 } = nextRngState(state);
    expect(rng1.nextInt(1000)).toBe(rng2.nextInt(1000));
    expect(rng1.nextInt(1000)).toBe(rng2.nextInt(1000));
  });
});

// ════════════════════════════════════════════════════════════════
// 状态完整性
// ════════════════════════════════════════════════════════════════

describe('状态字段完整性', () => {
  it('eventCounter 未在 createInitialState 中初始化', () => {
    const state = createTestGame({ playerCount: 2 });
    expect((state as any).eventCounter).toBeUndefined();
  });

  it('deferredDyingCheck 未在 createInitialState 中初始化', () => {
    const state = createTestGame({ playerCount: 2 });
    expect('deferredDyingCheck' in state).toBe(false);
  });
});
