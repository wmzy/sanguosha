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

    const p1View = fe.views['P1'];
    expect(p1View.self.hand).toHaveLength(2);
    expect(p1View.self.hand[0].id).toBe('c1');
    expect(p1View.self.hand[1].id).toBe('c2');
    expect(p1View.self.health).toBe(4);
    expect(p1View.self.maxHealth).toBe(4);
    expect(p1View.self.alive).toBe(true);
    expect(p1View.self.equipment).toEqual({ weapon: null, armor: null, mount: null });
    expect(p1View.self.pendingTricks).toEqual([]);
    expect(p1View.self.tags).toEqual([]);
    expect(p1View.self.vars).toEqual({});

    expect(p1View.others['P2'].handCount).toBe(1);
    expect(p1View.others['P3'].handCount).toBe(0);
    expect(p1View.others['P2'].health).toBe(4);

    const p2View = fe.views['P2'];
    expect(p2View.self.hand).toHaveLength(1);
    expect(p2View.others['P1'].handCount).toBe(2);
    expect(p2View.others['P3'].handCount).toBe(0);
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
    expect(fe.views['P1'].self.health).toBe(2);
    expect(fe.views['P1'].self.maxHealth).toBe(5);
    expect(fe.views['P1'].others['P2'].health).toBe(4);

    const p2View = fe.views['P2'];
    expect(p2View.others['P1'].health).toBe(2);
    expect(p2View.others['P1'].maxHealth).toBe(5);
  });

  it('sets table and turn defaults', () => {
    const fe = createFrontend({ A: {}, B: {} }, 'A');
    expect(fe.views['A'].table).toEqual({ discardPileCount: 0, deckCount: 80 });
    expect(fe.views['A'].turn.currentPlayer).toBe('A');
    expect(fe.views['A'].turn.phase).toBe('出牌');
    expect(fe.animationQueue).toEqual([]);
    expect(fe.pending).toBeNull();
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
    expect(cloned.views).not.toBe(original.views);
    expect(cloned.views['P1']).not.toBe(original.views['P1']);
    expect(cloned.views['P1'].self.hand[0]).not.toBe(original.views['P1'].self.hand[0]);
  });

  it('modifying clone does not affect original', () => {
    const original = createFrontend({ P1: { hand: ['c1'] }, P2: {} }, 'P1');
    const cloned = cloneFrontend(original);

    cloned.views['P1'].self.health = 0;
    cloned.views['P1'].self.hand[0].name = '闪';
    cloned.animationQueue.push({ type: 'death', player: 'P2' } as any);

    expect(original.views['P1'].self.health).toBe(4);
    expect(original.views['P1'].self.hand[0].name).toBe('杀');
    expect(original.animationQueue).toHaveLength(0);
  });
});
