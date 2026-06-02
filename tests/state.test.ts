/**
 * tests/state.test.ts — 状态管理函数
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
  checkWinCondition,
} from '@engine/state';
import type { GameState } from '@engine/types';
import { createRng } from '@shared/rng';
import { createTestGame } from './engine-helpers';

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
  it('returns a new state with rngState advanced by the RNG', () => {
    const state = createTestGame();
    const { state: newState } = nextRngState(state);
    const expected = createRng(state.rngState);
    expected.next();
    expect(newState.rngState).toBe(expected.getState());
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
    expect((state as unknown as Record<string, unknown>).eventCounter).toBeUndefined();
  });

  it('deferredDyingCheck 未在 createInitialState 中初始化', () => {
    const state = createTestGame({ playerCount: 2 });
    expect('deferredDyingCheck' in state).toBe(false);
  });
});

describe('checkWinCondition（身份局胜利条件）', () => {
  /** 把玩家标记为死亡并清空手牌/装备的辅助函数 */
  function kill(state: GameState, playerName: string): GameState {
    return updatePlayer(state, playerName, () => ({ info: { ...state.players[playerName].info, alive: false }, hand: [] }));
  }

  it('反贼全灭 + 忠臣存活 → 主公阵营胜', () => {
    let state = createTestGame({ playerCount: 4 });
    state = kill(state, 'P2'); // 反贼死
    expect(checkWinCondition(state)).toEqual({ winner: '主公', reason: '主公阵营获胜：所有反贼阵亡' });
  });

  it('反贼全灭 + 仅剩主公+内奸（无忠臣）→ 游戏继续（内奸必须先击败主公）', () => {
    let state = createTestGame({ playerCount: 4 });
    state = kill(state, 'P2'); // 反贼死
    state = kill(state, 'P3'); // 忠臣死
    expect(checkWinCondition(state)).toBeNull();
  });

  it('主公阵亡 + 仅剩内奸 → 内奸胜', () => {
    let state = createTestGame({ playerCount: 4 });
    state = kill(state, 'P1'); // 主公死
    state = kill(state, 'P2'); // 反贼死
    state = kill(state, 'P3'); // 忠臣死
    const result = checkWinCondition(state);
    expect(result).not.toBeNull();
    expect(result?.winner).toBe('P4');
  });

  it('主公阵亡 + 还有非内奸存活 → 反贼胜', () => {
    let state = createTestGame({ playerCount: 4 });
    state = kill(state, 'P1'); // 主公死
    // 反贼 P2 还活着
    expect(checkWinCondition(state)).toEqual({ winner: '反贼', reason: '反贼获胜：主公阵亡' });
  });

  it('所有玩家阵亡 → 平局', () => {
    let state = createTestGame({ playerCount: 3 });
    for (const name of ['P1', 'P2', 'P3']) {
      state = kill(state, name);
    }
    expect(checkWinCondition(state)).toEqual({ winner: '无', reason: '平局：所有玩家阵亡' });
  });

  it('游戏已结束时 checkWinCondition 返回 null', () => {
    const state = createTestGame({ playerCount: 2 });
    const ended: GameState = { ...state, meta: { ...state.meta, status: '已结束' } };
    expect(checkWinCondition(ended)).toBeNull();
  });
});
