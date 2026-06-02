import { describe, it, expect, beforeEach } from 'vitest';
import { reduceFrontend } from './reduceFrontend';
import {
  createFrontend,
  makePlayerEvent,
  resetEventCounter,
  cloneFrontend,
} from './helpers';
import type { CardInfo } from './types';

function cardInfo(id: string, name = '杀'): CardInfo {
  return {
    id,
    name,
    type: '基本牌',
    subtype: '杀',
    suit: '♠',
    rank: 'A',
    description: '',
  };
}

function setup(
  overrides?: Record<string, { health?: number; maxHealth?: number; hand?: string[] }>,
  myPlayerId = 'P1',
) {
  const defaults: Record<string, { health?: number; maxHealth?: number; hand?: string[] }> = {
    P1: { hand: ['c1', 'c2', 'c3'] },
    P2: { hand: ['c4'] },
    P3: {},
  };
  return createFrontend(overrides ?? defaults, myPlayerId);
}

describe('reduceFrontend', () => {
  beforeEach(() => resetEventCounter(0));

  // ─── damage ──────────────────────────────────────────────

  describe('damage', () => {
    it('reduces self health and adds animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('damage', { target: 'P1', amount: 2 }),
      ]);
      expect(result.views.P1.self.health).toBe(2);
      expect(result.animationQueue).toEqual([
        { type: 'damagePopup', target: 'P1', amount: 2 },
      ]);
    });

    it('reduces other player health', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('damage', { target: 'P2', amount: 3 }),
      ]);
      expect(result.views.P1.others.P2.health).toBe(1);
      expect(result.animationQueue[0]).toEqual({
        type: 'damagePopup',
        target: 'P2',
        amount: 3,
      });
    });
  });

  // ─── heal ────────────────────────────────────────────────

  describe('heal', () => {
    it('increases self health and adds animation', () => {
      const fe = setup({ P1: { health: 2 }, P2: {}, P3: {} });
      const result = reduceFrontend(fe, [
        makePlayerEvent('heal', { target: 'P1', amount: 1 }),
      ]);
      expect(result.views.P1.self.health).toBe(3);
      expect(result.animationQueue).toEqual([
        { type: 'healGlow', target: 'P1', amount: 1 },
      ]);
    });

    it('caps health at maxHealth', () => {
      const fe = setup({ P1: { health: 3, maxHealth: 4 }, P2: {}, P3: {} });
      const result = reduceFrontend(fe, [
        makePlayerEvent('heal', { target: 'P1', amount: 5 }),
      ]);
      expect(result.views.P1.self.health).toBe(4);
    });

    it('heals other player', () => {
      const fe = setup({ P1: { hand: ['c1', 'c2', 'c3'] }, P2: { health: 3 }, P3: {} });
      const result = reduceFrontend(fe, [
        makePlayerEvent('heal', { target: 'P2', amount: 1 }),
      ]);
      expect(result.views.P1.others.P2.health).toBe(4);
    });
  });

  // ─── draw ────────────────────────────────────────────────

  describe('draw', () => {
    it('adds cards to self hand', () => {
      const fe = setup();
      const cards = [cardInfo('c10'), cardInfo('c11')];
      const result = reduceFrontend(fe, [
        makePlayerEvent('draw', { player: 'P1', count: 2, cards }),
      ]);
      expect(result.views.P1.self.hand).toHaveLength(5);
      expect(result.views.P1.self.hand[3].id).toBe('c10');
      expect(result.views.P1.self.hand[4].id).toBe('c11');
    });

    it('increments handCount for others', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('draw', { player: 'P2', count: 3 }),
      ]);
      expect(result.views.P1.others.P2.handCount).toBe(4);
      expect(result.views.P1.self.hand).toHaveLength(3);
    });

    it('animation does not expose card details', () => {
      const fe = setup();
      const cards = [cardInfo('c10')];
      const result = reduceFrontend(fe, [
        makePlayerEvent('draw', { player: 'P1', count: 1, cards }),
      ]);
      const anim = result.animationQueue[0];
      expect(anim).toEqual({ type: 'drawCards', player: 'P1', count: 1 });
      expect(JSON.stringify(anim)).not.toContain('c10');
    });
  });

  // ─── discard ─────────────────────────────────────────────

  describe('discard', () => {
    it('removes cards from self hand', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('discard', { player: 'P1', cardIds: ['c1', 'c3'] }),
      ]);
      expect(result.views.P1.self.hand).toHaveLength(1);
      expect(result.views.P1.self.hand[0].id).toBe('c2');
    });

    it('decrements handCount for others using count', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('discard', { player: 'P2', count: 1 }),
      ]);
      expect(result.views.P1.others.P2.handCount).toBe(0);
    });

    it('decrements handCount for others using cardIds length', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('discard', { player: 'P2', cardIds: ['x1', 'x2'] }),
      ]);
      expect(result.views.P1.others.P2.handCount).toBe(-1);
    });

    it('adds discardCards animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('discard', { player: 'P1', cardIds: ['c1'] }),
      ]);
      expect(result.animationQueue[0]).toEqual({
        type: 'discardCards',
        player: 'P1',
        cardIds: ['c1'],
      });
    });
  });

  // ─── equip ───────────────────────────────────────────────

  describe('equip', () => {
    it('moves card from hand to equipment slot', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('equip', { player: 'P1', cardId: 'c1', slot: 'weapon' }),
      ]);
      expect(result.views.P1.self.hand).toHaveLength(2);
      expect(result.views.P1.self.hand.find(c => c.id === 'c1')).toBeUndefined();
      expect(result.views.P1.self.equipment.weapon).toBeTruthy();
      expect(result.views.P1.self.equipment.weapon!.id).toBe('c1');
    });

    it('replaces old equipment and increments discardPileCount', () => {
      const fe = setup();
      let result = reduceFrontend(fe, [
        makePlayerEvent('equip', { player: 'P1', cardId: 'c1', slot: 'weapon' }),
      ]);
      expect(result.views.P1.table.discardPileCount).toBe(0);
      result = reduceFrontend(result, [
        makePlayerEvent('equip', { player: 'P1', cardId: 'c2', slot: 'weapon' }),
      ]);
      expect(result.views.P1.table.discardPileCount).toBe(1);
      expect(result.views.P1.self.equipment.weapon!.id).toBe('c2');
    });

    it('adds equipItem animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('equip', { player: 'P1', cardId: 'c1', slot: 'armor' }),
      ]);
      expect(result.animationQueue[0]).toEqual({
        type: 'equipItem',
        player: 'P1',
        cardId: 'c1',
        slot: 'armor',
      });
    });
  });

  // ─── kill ────────────────────────────────────────────────

  describe('kill', () => {
    it('sets self health to 0 and alive to false', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('kill', { player: 'P1' }),
      ]);
      expect(result.views.P1.self.health).toBe(0);
      expect(result.views.P1.self.alive).toBe(false);
      expect(result.views.P1.self.equipment).toEqual({
        weapon: null,
        armor: null,
        mount: null,
      });
    });

    it('kills other player and clears equipment', () => {
      const fe = setup();
      let result = reduceFrontend(fe, [
        makePlayerEvent('equip', { player: 'P2', cardId: 'c4', slot: 'weapon' }),
      ]);
      expect(result.views.P1.others.P2.equipment.weapon).toBe('c4');
      result = reduceFrontend(result, [
        makePlayerEvent('kill', { player: 'P2' }),
      ]);
      expect(result.views.P1.others.P2.health).toBe(0);
      expect(result.views.P1.others.P2.alive).toBe(false);
      expect(result.views.P1.others.P2.equipment).toEqual({
        weapon: null,
        armor: null,
        mount: null,
      });
    });

    it('adds death animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('kill', { player: 'P2' }),
      ]);
      expect(result.animationQueue).toEqual([{ type: 'death', player: 'P2' }]);
    });
  });

  // ─── setPhase ────────────────────────────────────────────

  describe('setPhase', () => {
    it('changes turn phase', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('setPhase', { phase: '摸牌' }),
      ]);
      expect(result.views.P1.turn.phase).toBe('摸牌');
    });
  });

  // ─── nextPlayer ──────────────────────────────────────────

  describe('nextPlayer', () => {
    it('changes currentPlayer and resets phase', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('nextPlayer', { player: 'P2' }),
      ]);
      expect(result.views.P1.turn.currentPlayer).toBe('P2');
      expect(result.views.P1.turn.phase).toBe('准备');
    });

    it('supports "to" field from real atom', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('nextPlayer', { to: 'P3', from: 'P1', turnNumber: 2 }),
      ]);
      expect(result.views.P1.turn.currentPlayer).toBe('P3');
      expect(result.views.P1.turn.phase).toBe('准备');
    });

    it('adds nextPlayer animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('nextPlayer', { player: 'P2' }),
      ]);
      expect(result.animationQueue).toEqual([{ type: 'nextPlayer', player: 'P2' }]);
    });
  });

  // ─── pushPending / popPending ────────────────────────────

  describe('pushPending', () => {
    it('sets fe.pending to the event', () => {
      const fe = setup();
      const evt = makePlayerEvent('pushPending', { actionType: 'playPhase' });
      const result = reduceFrontend(fe, [evt]);
      expect(result.pending).toBe(evt);
    });

    it('adds pendingPrompt animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('pushPending', { actionType: 'responseWindow' }),
      ]);
      expect(result.animationQueue).toEqual([
        { type: 'pendingPrompt', actionType: 'responseWindow' },
      ]);
    });
  });

  describe('popPending', () => {
    it('clears fe.pending', () => {
      const fe = setup();
      const withPending = reduceFrontend(fe, [
        makePlayerEvent('pushPending', {}),
      ]);
      expect(withPending.pending).not.toBeNull();
      const result = reduceFrontend(withPending, [
        makePlayerEvent('popPending', {}),
      ]);
      expect(result.pending).toBeNull();
    });
  });

  // ─── judge ───────────────────────────────────────────────

  describe('judge', () => {
    it('increments discardPileCount and adds cardFlip animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('judge', { player: 'P1', cardId: 'j1', result: 'red' }),
      ]);
      expect(result.views.P1.table.discardPileCount).toBe(1);
      expect(result.animationQueue).toEqual([{ type: 'cardFlip', cardId: 'j1' }]);
    });
  });

  // ─── moveCard / cardMoved ────────────────────────────────

  describe('moveCard', () => {
    it('increments discardPileCount when to is discardPile', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('moveCard', {
          cardId: 'c1',
          from: { zone: 'hand', player: 'P1' },
          to: { zone: 'discardPile' },
        }),
      ]);
      expect(result.views.P1.table.discardPileCount).toBe(1);
      expect(result.animationQueue[0].type).toBe('cardMove');
    });

    it('handles cardMoved event type as alias', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('cardMoved', {
          cardId: 'c5',
          from: { zone: 'deck' },
          to: { zone: 'discardPile' },
        }),
      ]);
      expect(result.views.P1.table.discardPileCount).toBe(1);
    });
  });

  // ─── addTag / removeTag ──────────────────────────────────

  describe('addTag / removeTag', () => {
    it('adds tag to self', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('addTag', { player: 'P1', tag: '醉酒' }),
      ]);
      expect(result.views.P1.self.tags).toEqual(['醉酒']);
    });

    it('removes tag from self', () => {
      const fe = setup();
      const withTag = reduceFrontend(fe, [
        makePlayerEvent('addTag', { player: 'P1', tag: '醉酒' }),
      ]);
      const result = reduceFrontend(withTag, [
        makePlayerEvent('removeTag', { player: 'P1', tag: '醉酒' }),
      ]);
      expect(result.views.P1.self.tags).toEqual([]);
    });

    it('ignores tag events for other players', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('addTag', { player: 'P2', tag: '醉酒' }),
      ]);
      expect(result.views.P1.self.tags).toEqual([]);
    });
  });

  // ─── setVar ──────────────────────────────────────────────

  describe('setVar', () => {
    it('sets var on self', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('setVar', { player: 'P1', key: 'killsPlayed', value: 2 }),
      ]);
      expect(result.views.P1.self.vars['killsPlayed']).toBe(2);
    });

    it('ignores setVar for other players', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('setVar', { player: 'P2', key: 'killsPlayed', value: 1 }),
      ]);
      expect(result.views.P1.self.vars).toEqual({});
    });
  });

  // ─── addPendingTrick / removePendingTrick ─────────────────

  describe('addPendingTrick / removePendingTrick', () => {
    it('adds trick to self pendingTricks', () => {
      const fe = setup();
      const trick = { name: '乐不思蜀', source: 'P2', cardId: 't1' };
      const result = reduceFrontend(fe, [
        makePlayerEvent('addPendingTrick', { player: 'P1', trick }),
      ]);
      expect(result.views.P1.self.pendingTricks).toHaveLength(1);
      expect(result.views.P1.self.pendingTricks[0].cardId).toBe('t1');
    });

    it('removes trick by index', () => {
      const fe = setup();
      const trick1 = { name: '乐不思蜀', source: 'P2', cardId: 't1' };
      const trick2 = { name: '兵粮寸断', source: 'P3', cardId: 't2' };
      const withTricks = reduceFrontend(fe, [
        makePlayerEvent('addPendingTrick', { player: 'P1', trick: trick1 }),
        makePlayerEvent('addPendingTrick', { player: 'P1', trick: trick2 }),
      ]);
      expect(withTricks.views.P1.self.pendingTricks).toHaveLength(2);
      const result = reduceFrontend(withTricks, [
        makePlayerEvent('removePendingTrick', {
          player: 'P1',
          index: 0,
          result: 'success',
        }),
      ]);
      expect(result.views.P1.self.pendingTricks).toHaveLength(1);
      expect(result.views.P1.self.pendingTricks[0].cardId).toBe('t2');
    });

    it('adds animations for addPendingTrick and removePendingTrick', () => {
      const fe = setup();
      const trick = { name: '乐不思蜀', source: 'P2', cardId: 't1' };
      const result = reduceFrontend(fe, [
        makePlayerEvent('addPendingTrick', { player: 'P1', trick }),
      ]);
      expect(result.animationQueue).toEqual([
        { type: 'pendingPrompt', actionType: 'addPendingTrick' },
      ]);

      const result2 = reduceFrontend(result, [
        makePlayerEvent('removePendingTrick', {
          player: 'P1',
          index: 0,
          cardId: 't1',
          result: 'fail',
        }),
      ]);
      expect(result2.animationQueue[1]).toEqual({
        type: 'trickReveal',
        cardId: 't1',
        result: 'fail',
      });
    });
  });

  // ─── turnStart / rearrangeDeck ───────────────────────────

  describe('turnStart', () => {
    it('sets currentPlayer', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('turnStart', { player: 'P3' }),
      ]);
      expect(result.views.P1.turn.currentPlayer).toBe('P3');
    });
  });

  describe('rearrangeDeck', () => {
    it('produces no visible change', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('rearrangeDeck', { player: 'P1', topCardIds: [], bottomCardIds: [] }),
      ]);
      expect(result.views.P1).toEqual(fe.views.P1);
      expect(result.animationQueue).toEqual([]);
    });
  });

  // ─── skillActivate ───────────────────────────────────────

  describe('skillActivate', () => {
    it('adds skillActivate animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('skillActivate', { player: 'P1', skillId: 'qinglong' }),
      ]);
      expect(result.animationQueue).toEqual([
        { type: 'skillActivate', player: 'P1', skillId: 'qinglong' },
      ]);
    });
  });

  // ─── gainCard / cardGained ───────────────────────────────

  describe('gainCard', () => {
    it('adds card to self hand', () => {
      const fe = setup();
      const card = cardInfo('c99', '桃');
      const result = reduceFrontend(fe, [
        makePlayerEvent('gainCard', {
          player: 'P1',
          cardId: 'c99',
          card,
          from: { zone: 'discardPile' },
        }),
      ]);
      expect(result.views.P1.self.hand).toHaveLength(4);
      expect(result.views.P1.self.hand[3].id).toBe('c99');
    });

    it('increments handCount for others', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('gainCard', {
          player: 'P2',
          cardId: 'c99',
          from: { zone: 'discardPile' },
        }),
      ]);
      expect(result.views.P1.others.P2.handCount).toBe(2);
    });

    it('adds cardMove animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('gainCard', {
          player: 'P1',
          cardId: 'c99',
          card: cardInfo('c99'),
          from: { zone: 'discardPile' },
        }),
      ]);
      const anim = result.animationQueue[0];
      expect(anim.type).toBe('cardMove');
    });
  });

  // ─── combined / edge cases ───────────────────────────────

  describe('multiple events in sequence', () => {
    it('produces correct cumulative state', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('damage', { target: 'P1', amount: 1 }),
        makePlayerEvent('heal', { target: 'P1', amount: 1 }),
        makePlayerEvent('damage', { target: 'P1', amount: 2 }),
        makePlayerEvent('setPhase', { phase: '弃牌' }),
      ]);
      expect(result.views.P1.self.health).toBe(2);
      expect(result.views.P1.turn.phase).toBe('弃牌');
      expect(result.animationQueue).toHaveLength(3);
    });
  });

  describe('unknown event type', () => {
    it('is silently skipped', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('someFutureEvent', { foo: 'bar' }),
      ]);
      expect(result.views.P1).toEqual(fe.views.P1);
      expect(result.animationQueue).toEqual([]);
    });
  });

  describe('immutability', () => {
    it('does not mutate the original state', () => {
      const fe = setup();
      const original = cloneFrontend(fe);
      reduceFrontend(fe, [
        makePlayerEvent('damage', { target: 'P1', amount: 3 }),
        makePlayerEvent('setPhase', { phase: '摸牌' }),
      ]);
      expect(fe.views.P1.self.health).toBe(original.views.P1.self.health);
      expect(fe.views.P1.turn.phase).toBe(original.views.P1.turn.phase);
      expect(fe.animationQueue).toEqual([]);
    });
  });

  describe('cardsDiscarded alias', () => {
    it('handles cardsDiscarded event type like discard', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('cardsDiscarded', { player: 'P1', cardIds: ['c2'] }),
      ]);
      expect(result.views.P1.self.hand).toHaveLength(2);
      expect(result.views.P1.self.hand.find(c => c.id === 'c2')).toBeUndefined();
    });
  });

  describe('cardGained alias', () => {
    it('handles cardGained event type like gainCard', () => {
      const fe = setup();
      const card = cardInfo('c88');
      const result = reduceFrontend(fe, [
        makePlayerEvent('cardGained', {
          player: 'P1',
          cardId: 'c88',
          card,
          from: { zone: 'hand', player: 'P2' },
        }),
      ]);
      expect(result.views.P1.self.hand).toHaveLength(4);
    });
  });
});
