import { describe, it, expect, beforeEach } from 'vitest';
import {
  createFrontend,
  makeView,
  makePlayerEvent,
  cloneFrontend,
  resetEventCounter,
} from './helpers';

describe('createFrontend', () => {
  it('creates correct self/others structure', () => {
    const fe = createFrontend(
      { P1: { hand: ['c1', 'c2'] }, P2: { hand: ['c3'] }, P3: {} },
      'P1',
    );

    expect(fe.myPlayerId).toBe('P1');
    expect(fe.view.self.hand).toHaveLength(2);
    expect(fe.view.self.hand[0].id).toBe('c1');
    expect(fe.view.self.hand[1].id).toBe('c2');
    expect(fe.view.self.health).toBe(4);
    expect(fe.view.self.maxHealth).toBe(4);
    expect(fe.view.self.alive).toBe(true);
    expect(fe.view.self.equipment).toEqual({ weapon: null, armor: null, mount: null });
    expect(fe.view.self.pendingTricks).toEqual([]);
    expect(fe.view.self.tags).toEqual([]);
    expect(fe.view.self.vars).toEqual({});

    expect(fe.view.others['P2'].handCount).toBe(1);
    expect(fe.view.others['P3'].handCount).toBe(0);
    expect(fe.view.others['P2'].health).toBe(4);
  });

  it('sets myPlayerId correctly', () => {
    const fe = createFrontend({ P1: {}, P2: {} }, 'P2');
    expect(fe.myPlayerId).toBe('P2');
  });

  it('uses custom health and maxHealth', () => {
    const fe = createFrontend(
      { P1: { health: 2, maxHealth: 5 }, P2: {} },
      'P1',
    );
    expect(fe.view.self.health).toBe(2);
    expect(fe.view.self.maxHealth).toBe(5);
    expect(fe.view.others['P2'].health).toBe(4);
    expect(fe.view.others['P2'].maxHealth).toBe(4);
  });

  it('sets table and turn defaults', () => {
    const fe = createFrontend({ A: {}, B: {} }, 'A');
    expect(fe.view.table).toEqual({ discardPileCount: 0, deckCount: 80 });
    expect(fe.view.turn.currentPlayer).toBe('A');
    expect(fe.view.turn.phase).toBe('出牌');
    expect(fe.animationQueue).toEqual([]);
    expect(fe.view.pending).toBeNull();
  });
});

describe('makeView', () => {
  it('works with empty overrides', () => {
    const view = makeView();
    expect(view.self.hand).toEqual([]);
    expect(view.others).toEqual({});
    expect(view.table).toEqual({ discardPileCount: 0, deckCount: 80 });
    expect(view.turn).toEqual({ phase: '出牌', currentPlayer: 'P1', killsPlayed: 0 });
  });

  it('merges overrides correctly', () => {
    const view = makeView({
      turn: { phase: '摸牌', currentPlayer: 'P2' },
      table: { discardPileCount: 5, deckCount: 70 },
    });
    expect(view.turn).toEqual({ phase: '摸牌', currentPlayer: 'P2', killsPlayed: 0 });
    expect(view.table.discardPileCount).toBe(5);
    expect(view.table.deckCount).toBe(70);
    expect(view.self.hand).toEqual([]);
  });
});

describe('makePlayerEvent', () => {
  beforeEach(() => {
    resetEventCounter(0);
  });

  it('creates events with incrementing ids', () => {
    const e1 = makePlayerEvent('draw', { player: 'P1' });
    const e2 = makePlayerEvent('damage', { player: 'P2' });
    expect(e1.id).toBe('evt-1');
    expect(e2.id).toBe('evt-2');
    expect(e1.type).toBe('draw');
    expect(e2.type).toBe('damage');
    expect(e1.payload).toEqual({ player: 'P1' });
    expect(e2.payload).toEqual({ player: 'P2' });
  });

  it('defaults payload to empty object', () => {
    const evt = makePlayerEvent('test');
    expect(evt.payload).toEqual({});
    expect(evt).toHaveProperty('timestamp');
  });
});

describe('cloneFrontend', () => {
  it('produces a deep copy', () => {
    const original = createFrontend({ P1: { hand: ['c1'] }, P2: {} }, 'P1');
    const cloned = cloneFrontend(original);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.view).not.toBe(original.view);
    expect(cloned.view.self.hand[0]).not.toBe(original.view.self.hand[0]);
  });

  it('modifying clone does not affect original', () => {
    const original = createFrontend({ P1: { hand: ['c1'] }, P2: {} }, 'P1');
    const cloned = cloneFrontend(original);

    cloned.view.self.health = 0;
    cloned.view.self.hand[0].name = '闪';
    cloned.animationQueue.push({ type: 'death', player: 'P2' });

    expect(original.view.self.health).toBe(4);
    expect(original.view.self.hand[0].name).toBe('杀');
    expect(original.animationQueue).toHaveLength(0);
  });
});
