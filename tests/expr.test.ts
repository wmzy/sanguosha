/**
 * tests/v2/expr.test.ts — 表达式求值和条件检查
 */
import { describe, it, expect } from 'vitest';
import { resolve, checkCondition } from '@engine/expr';
import type { Expr, Condition, SkillContext, GameState } from '@engine/types';
import { createTestGame } from './engine-helpers';

function ctx(overrides?: Partial<SkillContext>): SkillContext {
  return {
    skillId: 'test-skill',
    self: 'P1',
    localVars: {},
    ...overrides,
  };
}

function stateWithVars(vars: Record<string, unknown>): GameState {
  const s = createTestGame({ playPhase: true });
  return {
    ...s,
    players: {
      ...s.players,
      P1: { ...s.players.P1, vars: vars as Record<string, import('@engine/types').Json> },
    },
  };
}

// ─── resolve() ──────────────────────────────────────────────────

describe('resolve', () => {
  const state = createTestGame({ playPhase: true });

  it('returns plain values as-is', () => {
    expect(resolve(42, state)).toBe(42);
    expect(resolve('hello', state)).toBe('hello');
    expect(resolve(true, state)).toBe(true);
    expect(resolve(null, state)).toBe(null);
  });

  it('resolves ctx path', () => {
    const c = ctx({ self: '曹操', target: '刘备' });
    expect(resolve({ $: 'ctx', path: 'self' }, state, c)).toBe('曹操');
    expect(resolve({ $: 'ctx', path: 'target' }, state, c)).toBe('刘备');
  });

  it('throws on missing ctx', () => {
    expect(() => resolve({ $: 'ctx', path: 'self' }, state)).toThrow('no SkillContext');
  });

  it('resolves var from player', () => {
    const s = stateWithVars({ testKey: 'testVal', count: 5 });
    expect(resolve({ $: 'var', player: 'P1', key: 'testKey' }, s)).toBe('testVal');
    expect(resolve({ $: 'var', player: 'P1', key: 'count' }, s)).toBe(5);
  });

  it('resolves count of a player zone', () => {
    // count with player name 'P1' tries player['P1'] which is undefined → 0
    expect(resolve({ $: 'count', source: 'P1' }, state)).toBe(0);
  });

  it('resolves count of an array from ctx', () => {
    const c = ctx({ choice: ['a', 'b', 'c'] });
    expect(resolve({ $: 'count', source: { $: 'ctx', path: 'choice' } }, state, c)).toBe(3);
  });

  it('resolves handSize', () => {
    expect(resolve({ $: 'handSize', player: 'P1' }, state)).toBe(4);
  });

  it('resolves aliveCount', () => {
    expect(resolve({ $: 'aliveCount' }, state)).toBe(2);
  });

  it('resolves distance', () => {
    // 2 players, distance = 1
    expect(resolve({ $: 'distance', from: 'P1', to: 'P2' }, state)).toBe(1);
  });

  it('resolves cardProp', () => {
    const cardId = state.players.P1.hand[0];
    const card = state.cardMap[cardId];
    expect(resolve({ $: 'cardProp', card: cardId, prop: 'name' }, state)).toBe(card.name);
    expect(resolve({ $: 'cardProp', card: cardId, prop: 'suit' }, state)).toBe(card.suit);
  });

  it('resolves cond - then branch', () => {
    const expr: Expr<number> = {
      $: 'cond',
      check: { equals: [1, 1] },
      then: 100,
      else: 200,
    };
    expect(resolve(expr, state)).toBe(100);
  });

  it('resolves cond - else branch', () => {
    const expr: Expr<number> = {
      $: 'cond',
      check: { equals: [1, 2] },
      then: 100,
      else: 200,
    };
    expect(resolve(expr, state)).toBe(200);
  });

  it('resolves add', () => {
    expect(resolve({ $: 'add', left: 3, right: 4 }, state)).toBe(7);
  });

  it('resolves sub', () => {
    expect(resolve({ $: 'sub', left: 10, right: 3 }, state)).toBe(7);
  });

  it('resolves nested expressions', () => {
    // handSize P1 + handSize P2
    const expr: Expr<number> = {
      $: 'add',
      left: { $: 'handSize', player: 'P1' },
      right: { $: 'handSize', player: 'P2' },
    };
    expect(resolve(expr, state)).toBe(8);
  });

  it('throws on max recursion depth', () => {
    // Build a deeply nested add chain
    let expr: Expr<number> = 1;
    for (let i = 0; i < 25; i++) {
      expr = { $: 'add', left: expr, right: 1 };
    }
    expect(() => resolve(expr, state)).toThrow('max recursion depth');
  });
});

// ─── checkCondition() ───────────────────────────────────────────

describe('checkCondition', () => {
  const state = createTestGame({ playPhase: true });

  describe('equals / notEquals', () => {
    it('compares primitives', () => {
      expect(checkCondition({ equals: [1, 1] }, state)).toBe(true);
      expect(checkCondition({ equals: [1, 2] }, state)).toBe(false);
      expect(checkCondition({ equals: ['a', 'a'] }, state)).toBe(true);
      expect(checkCondition({ equals: ['a', 'b'] }, state)).toBe(false);
    });

    it('compares arrays', () => {
      expect(checkCondition({ equals: [[1, 2], [1, 2]] }, state)).toBe(true);
      expect(checkCondition({ equals: [[1, 2], [1, 3]] }, state)).toBe(false);
      expect(checkCondition({ equals: [[1, 2], [1, 2, 3]] }, state)).toBe(false);
    });

    it('compares objects', () => {
      expect(checkCondition({ equals: [{ a: 1 }, { a: 1 }] }, state)).toBe(true);
      expect(checkCondition({ equals: [{ a: 1 }, { a: 2 }] }, state)).toBe(false);
    });

    it('handles null', () => {
      expect(checkCondition({ equals: [null, null] }, state)).toBe(true);
      expect(checkCondition({ equals: [null, undefined] }, state)).toBe(false);
    });

    it('notEquals is inverse', () => {
      expect(checkCondition({ notEquals: [1, 2] }, state)).toBe(true);
      expect(checkCondition({ notEquals: [1, 1] }, state)).toBe(false);
    });
  });

  describe('numeric comparisons', () => {
    it('gte', () => {
      expect(checkCondition({ gte: [5, 3] }, state)).toBe(true);
      expect(checkCondition({ gte: [3, 3] }, state)).toBe(true);
      expect(checkCondition({ gte: [2, 3] }, state)).toBe(false);
    });

    it('lte', () => {
      expect(checkCondition({ lte: [2, 3] }, state)).toBe(true);
      expect(checkCondition({ lte: [3, 3] }, state)).toBe(true);
      expect(checkCondition({ lte: [5, 3] }, state)).toBe(false);
    });

    it('gt', () => {
      expect(checkCondition({ gt: [5, 3] }, state)).toBe(true);
      expect(checkCondition({ gt: [3, 3] }, state)).toBe(false);
    });

    it('lt', () => {
      expect(checkCondition({ lt: [2, 3] }, state)).toBe(true);
      expect(checkCondition({ lt: [3, 3] }, state)).toBe(false);
    });

    it('with Expr operands', () => {
      // handSize P1 (4) >= 4
      expect(checkCondition({ gte: [{ $: 'handSize', player: 'P1' }, 4] }, state)).toBe(true);
    });
  });

  describe('player state checks', () => {
    it('hasVar', () => {
      const s = stateWithVars({ key1: 'val' });
      expect(checkCondition({ hasVar: { player: 'P1', key: 'key1' } }, s)).toBe(true);
      expect(checkCondition({ hasVar: { player: 'P1', key: 'missing' } }, s)).toBe(false);
    });

    it('hasTag', () => {
      const s = createTestGame({ playPhase: true });
      s.players.P1.tags.push('poisoned');
      expect(checkCondition({ hasTag: { player: 'P1', tag: 'poisoned' } }, s)).toBe(true);
      expect(checkCondition({ hasTag: { player: 'P1', tag: 'healed' } }, s)).toBe(false);
    });

    it('isAlive', () => {
      expect(checkCondition({ isAlive: 'P1' }, state)).toBe(true);
    });

    it('handEmpty', () => {
      expect(checkCondition({ handEmpty: 'P1' }, state)).toBe(false);
      const s = stateWithVars({});
      s.players.P1.hand = [];
      expect(checkCondition({ handEmpty: 'P1' }, s)).toBe(true);
    });

    it('hasValue', () => {
      const c = ctx({ target: 'P2' });
      expect(checkCondition({ hasValue: { $: 'ctx', path: 'target' } }, state, c)).toBe(true);
      const c2 = ctx({ target: undefined });
      expect(checkCondition({ hasValue: { $: 'ctx', path: 'target' } }, state, c2)).toBe(false);
    });
  });

  describe('logical combinators', () => {
    it('and - all true', () => {
      expect(checkCondition({ and: [{ equals: [1, 1] }, { equals: [2, 2] }] }, state)).toBe(true);
    });

    it('and - one false', () => {
      expect(checkCondition({ and: [{ equals: [1, 1] }, { equals: [1, 2] }] }, state)).toBe(false);
    });

    it('and - short circuits', () => {
      // First is false, second should not be evaluated
      expect(checkCondition({ and: [{ equals: [1, 2] }, { equals: [1, 1] }] }, state)).toBe(false);
    });

    it('or - one true', () => {
      expect(checkCondition({ or: [{ equals: [1, 2] }, { equals: [2, 2] }] }, state)).toBe(true);
    });

    it('or - all false', () => {
      expect(checkCondition({ or: [{ equals: [1, 2] }, { equals: [3, 4] }] }, state)).toBe(false);
    });

    it('not', () => {
      expect(checkCondition({ not: { equals: [1, 2] } }, state)).toBe(true);
      expect(checkCondition({ not: { equals: [1, 1] } }, state)).toBe(false);
    });

    it('nested combinators', () => {
      // (1 == 1) AND ((2 > 1) OR (3 < 1))
      const cond: Condition = {
        and: [
          { equals: [1, 1] },
          { or: [{ gt: [2, 1] }, { lt: [3, 1] }] },
        ],
      };
      expect(checkCondition(cond, state)).toBe(true);
    });
  });

  it('returns false for unknown condition shape', () => {
    expect(checkCondition({ unknown: 'test' } as unknown as import('@engine/types').Condition, state)).toBe(false);
  });

  it('throws on max recursion depth', () => {
    let cond: Condition = { equals: [1, 1] };
    for (let i = 0; i < 25; i++) {
      cond = { not: cond };
    }
    expect(() => checkCondition(cond, state)).toThrow('max recursion depth');
  });
});
