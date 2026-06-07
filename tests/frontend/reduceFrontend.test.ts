import { describe, it, expect, beforeEach } from 'vitest';
import { reduceFrontend } from '@engine/view/reducer';
import {
  createFrontend,
  makePlayerEvent,
  resetEventCounter,
  cloneFrontend,
} from './helpers';
import type { CardInfo } from '@engine/view/types';

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

  describe('造成伤害', () => {
    it('reduces self health and adds animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('造成伤害', { target: 'P1', amount: 2 }),
      ]);
      expect(result.view.self.health).toBe(2);
      expect(result.animationQueue).toEqual([
        { type: 'damagePopup', target: 'P1', amount: 2 },
      ]);
    });

    it('reduces other player health', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('造成伤害', { target: 'P2', amount: 3 }),
      ]);
      expect(result.view.others.P2.health).toBe(1);
      expect(result.animationQueue[0]).toEqual({
        type: 'damagePopup',
        target: 'P2',
        amount: 3,
      });
    });
  });

  // ─── heal ────────────────────────────────────────────────

  describe('回复体力', () => {
    it('increases self health and adds animation', () => {
      const fe = setup({ P1: { health: 2 }, P2: {}, P3: {} });
      const result = reduceFrontend(fe, [
        makePlayerEvent('回复体力', { target: 'P1', amount: 1 }),
      ]);
      expect(result.view.self.health).toBe(3);
      expect(result.animationQueue).toEqual([
        { type: 'healGlow', target: 'P1', amount: 1 },
      ]);
    });

    it('caps health at maxHealth', () => {
      const fe = setup({ P1: { health: 3, maxHealth: 4 }, P2: {}, P3: {} });
      const result = reduceFrontend(fe, [
        makePlayerEvent('回复体力', { target: 'P1', amount: 5 }),
      ]);
      expect(result.view.self.health).toBe(4);
    });

    it('heals other player', () => {
      const fe = setup({ P1: { hand: ['c1', 'c2', 'c3'] }, P2: { health: 3 }, P3: {} });
      const result = reduceFrontend(fe, [
        makePlayerEvent('回复体力', { target: 'P2', amount: 1 }),
      ]);
      expect(result.view.others.P2.health).toBe(4);
    });
  });

  // ─── draw ────────────────────────────────────────────────

  describe('摸牌', () => {
    it('adds cards to self hand', () => {
      const fe = setup();
      const cards = [cardInfo('c10'), cardInfo('c11')];
      const result = reduceFrontend(fe, [
        makePlayerEvent('摸牌', { player: 'P1', count: 2, cards }),
      ]);
      expect(result.view.self.hand).toHaveLength(5);
      expect(result.view.self.hand[3].id).toBe('c10');
      expect(result.view.self.hand[4].id).toBe('c11');
    });

    it('increments handCount for others', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('摸牌', { player: 'P2', count: 3 }),
      ]);
      expect(result.view.others.P2.handCount).toBe(4);
      expect(result.view.self.hand).toHaveLength(3);
    });

    it('animation does not expose card details', () => {
      const fe = setup();
      const cards = [cardInfo('c10')];
      const result = reduceFrontend(fe, [
        makePlayerEvent('摸牌', { player: 'P1', count: 1, cards }),
      ]);
      const anim = result.animationQueue[0];
      expect(anim).toEqual({ type: 'drawCards', player: 'P1', count: 1 });
      expect(JSON.stringify(anim)).not.toContain('c10');
    });
  });

  // ─── discard ─────────────────────────────────────────────

  describe('弃置', () => {
    it('removes cards from self hand', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('弃置', { player: 'P1', cardIds: ['c1', 'c3'] }),
      ]);
      expect(result.view.self.hand).toHaveLength(1);
      expect(result.view.self.hand[0].id).toBe('c2');
    });

    it('decrements handCount for others using count', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('弃置', { player: 'P2', count: 1 }),
      ]);
      expect(result.view.others.P2.handCount).toBe(0);
    });

    it('decrements handCount for others using cardIds length', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('弃置', { player: 'P2', cardIds: ['x1', 'x2'] }),
      ]);
      expect(result.view.others.P2.handCount).toBe(-1);
    });

    it('adds discardCards animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('弃置', { player: 'P1', cardIds: ['c1'] }),
      ]);
      expect(result.animationQueue[0]).toEqual({
        type: 'discardCards',
        player: 'P1',
        cardIds: ['c1'],
      });
    });
  });

  // ─── equip ───────────────────────────────────────────────

  describe('装备', () => {
    it('moves card from hand to equipment slot', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('装备', { player: 'P1', cardId: 'c1', slot: '武器' }),
      ]);
      expect(result.view.self.hand).toHaveLength(2);
      expect(result.view.self.hand.find(c => c.id === 'c1')).toBeUndefined();
      expect(result.view.self.equipment.weapon).toBeTruthy();
      expect(result.view.self.equipment.weapon!.id).toBe('c1');
    });

    it('replaces old equipment and increments discardPileCount', () => {
      const fe = setup();
      let result = reduceFrontend(fe, [
        makePlayerEvent('装备', { player: 'P1', cardId: 'c1', slot: '武器' }),
      ]);
      expect(result.view.table.discardPileCount).toBe(0);
      result = reduceFrontend(result, [
        makePlayerEvent('装备', { player: 'P1', cardId: 'c2', slot: '武器' }),
      ]);
      expect(result.view.table.discardPileCount).toBe(1);
      expect(result.view.self.equipment.weapon!.id).toBe('c2');
    });

    it('adds equipItem animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('装备', { player: 'P1', cardId: 'c1', slot: '防具' }),
      ]);
      expect(result.animationQueue[0]).toEqual({
        type: 'equipItem',
        player: 'P1',
        cardId: 'c1',
        slot: '防具',
      });
    });
  });

  // ─── kill ────────────────────────────────────────────────

  describe('击杀', () => {
    it('sets self health to 0 and alive to false', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('击杀', { player: 'P1' }),
      ]);
      expect(result.view.self.health).toBe(0);
      expect(result.view.self.alive).toBe(false);
      expect(result.view.self.equipment).toEqual({
        weapon: null,
        armor: null,
        mount: null,
      });
    });

    it('kills other player and clears equipment', () => {
      const fe = setup();
      let result = reduceFrontend(fe, [
        makePlayerEvent('装备', { player: 'P2', cardId: 'c4', slot: '武器' }),
      ]);
      expect(result.view.others.P2.equipment.weapon).toBe('c4');
      result = reduceFrontend(result, [
        makePlayerEvent('击杀', { player: 'P2' }),
      ]);
      expect(result.view.others.P2.health).toBe(0);
      expect(result.view.others.P2.alive).toBe(false);
      expect(result.view.others.P2.equipment).toEqual({
        weapon: null,
        armor: null,
        mount: null,
      });
    });

    it('adds death animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('击杀', { player: 'P2' }),
      ]);
      expect(result.animationQueue).toEqual([{ type: '死亡', player: 'P2' }]);
    });
  });

  // ─── setPhase ────────────────────────────────────────────

  describe('设阶段', () => {
    it('changes turn phase', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('设阶段', { phase: '摸牌' }),
      ]);
      expect(result.view.turn.phase).toBe('摸牌');
    });
  });

  // ─── nextPlayer ──────────────────────────────────────────

  describe('下一玩家', () => {
    it('changes currentPlayer and resets phase', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('下一玩家', { player: 'P2' }),
      ]);
      expect(result.view.turn.currentPlayer).toBe('P2');
      expect(result.view.turn.phase).toBe('准备');
    });

    it('supports "to" field from real atom', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('下一玩家', { to: 'P3', from: 'P1', turnNumber: 2 }),
      ]);
      expect(result.view.turn.currentPlayer).toBe('P3');
      expect(result.view.turn.phase).toBe('准备');
    });

    it('adds nextPlayer animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('下一玩家', { player: 'P2' }),
      ]);
      expect(result.animationQueue).toEqual([{ type: '下一玩家', player: 'P2' }]);
    });
  });

  // ─── pushPending / popPending ────────────────────────────

  describe('推入待定', () => {
    it('sets view.pending state via animation queue', () => {
      const fe = setup();
      const evt = makePlayerEvent('推入待定', { actionType: '出牌阶段' });
      const result = reduceFrontend(fe, [evt]);
      expect(result.animationQueue).toEqual([
        { type: 'pendingPrompt', actionType: '出牌阶段' },
      ]);
      // pushPending 在新设计里只触发动画（具体 pending 状态由 server 推送的 initialView / 单独消息维护）
    });

    it('adds pendingPrompt animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('推入待定', { actionType: '响应窗口' }),
      ]);
      expect(result.animationQueue).toEqual([
        { type: 'pendingPrompt', actionType: '响应窗口' },
      ]);
    });
  });

  describe('弹出待定', () => {
    it('clears view.pending to null', () => {
      const fe = setup();
      fe.view.pending = null;
      const result = reduceFrontend(fe, [
        makePlayerEvent('弹出待定', {}),
      ]);
      expect(result.view.pending).toBeNull();
    });
  });

  // ─── judge ───────────────────────────────────────────────

  describe('判定', () => {
    it('increments discardPileCount and adds cardFlip animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('判定', { player: 'P1', cardId: 'j1', result: '红' }),
      ]);
      expect(result.view.table.discardPileCount).toBe(1);
      expect(result.animationQueue).toEqual([{ type: 'cardFlip', cardId: 'j1' }]);
    });
  });

  // ─── moveCard / cardMoved ────────────────────────────────

  describe('移动牌', () => {
    it('increments discardPileCount when to is discardPile', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('移动牌', {
          cardId: 'c1',
          from: { zone: '手牌', player: 'P1' },
          to: { zone: '弃牌堆' },
        }),
      ]);
      expect(result.view.table.discardPileCount).toBe(1);
      expect(result.animationQueue[0].type).toBe('cardMove');
    });

    it('handles cardMoved event type as alias', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('移动牌', {
          cardId: 'c5',
          from: { zone: '牌堆' },
          to: { zone: '弃牌堆' },
        }),
      ]);
      expect(result.view.table.discardPileCount).toBe(1);
    });
  });

  // ─── addTag / removeTag ──────────────────────────────────

  describe('addTag / removeTag', () => {
    it('adds tag to self', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('加标签', { player: 'P1', tag: '醉酒' }),
      ]);
      expect(result.view.self.tags).toEqual(['醉酒']);
    });

    it('removes tag from self', () => {
      const fe = setup();
      const withTag = reduceFrontend(fe, [
        makePlayerEvent('加标签', { player: 'P1', tag: '醉酒' }),
      ]);
      const result = reduceFrontend(withTag, [
        makePlayerEvent('去标签', { player: 'P1', tag: '醉酒' }),
      ]);
      expect(result.view.self.tags).toEqual([]);
    });

    it('ignores tag events for other players', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('加标签', { player: 'P2', tag: '醉酒' }),
      ]);
      expect(result.view.self.tags).toEqual([]);
    });
  });

  // ─── setVar ──────────────────────────────────────────────

  describe('设置变量', () => {
    it('sets var on self', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('设置变量', { player: 'P1', key: 'killsPlayed', value: 2 }),
      ]);
      expect(result.view.self.vars['killsPlayed']).toBe(2);
    });

    it('ignores setVar for other players', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('设置变量', { player: 'P2', key: 'killsPlayed', value: 1 }),
      ]);
      expect(result.view.self.vars).toEqual({});
    });
  });

  // ─── addPendingTrick / removePendingTrick ─────────────────

  describe('addPendingTrick / removePendingTrick', () => {
    it('adds trick to self pendingTricks', () => {
      const fe = setup();
      const trick = { name: '乐不思蜀', source: 'P2', cardId: 't1' };
      const result = reduceFrontend(fe, [
        makePlayerEvent('添加延时锦囊', { player: 'P1', trick }),
      ]);
      expect(result.view.self.pendingTricks).toHaveLength(1);
      expect(result.view.self.pendingTricks[0].cardId).toBe('t1');
    });

    it('removes trick by index', () => {
      const fe = setup();
      const trick1 = { name: '乐不思蜀', source: 'P2', cardId: 't1' };
      const trick2 = { name: '兵粮寸断', source: 'P3', cardId: 't2' };
      const withTricks = reduceFrontend(fe, [
        makePlayerEvent('添加延时锦囊', { player: 'P1', trick: trick1 }),
        makePlayerEvent('添加延时锦囊', { player: 'P1', trick: trick2 }),
      ]);
      expect(withTricks.view.self.pendingTricks).toHaveLength(2);
      const result = reduceFrontend(withTricks, [
        makePlayerEvent('移除延时锦囊', {
          player: 'P1',
          index: 0,
          result: 'success',
        }),
      ]);
      expect(result.view.self.pendingTricks).toHaveLength(1);
      expect(result.view.self.pendingTricks[0].cardId).toBe('t2');
    });

    it('adds animations for addPendingTrick and removePendingTrick', () => {
      const fe = setup();
      const trick = { name: '乐不思蜀', source: 'P2', cardId: 't1' };
      const result = reduceFrontend(fe, [
        makePlayerEvent('添加延时锦囊', { player: 'P1', trick }),
      ]);
      expect(result.animationQueue).toEqual([
        { type: 'pendingPrompt', actionType: '添加延时锦囊' },
      ]);

      const result2 = reduceFrontend(result, [
        makePlayerEvent('移除延时锦囊', {
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

  describe('回合开始', () => {
    it('sets currentPlayer', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('回合开始', { player: 'P3' }),
      ]);
      expect(result.view.turn.currentPlayer).toBe('P3');
    });
  });

  describe('整理牌堆', () => {
    it('produces no visible change', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('整理牌堆', { player: 'P1', topCardIds: [], bottomCardIds: [] }),
      ]);
      expect(result.view).toEqual(fe.view);
      expect(result.animationQueue).toEqual([]);
    });
  });

  // ─── skillActivate ───────────────────────────────────────

  describe('技能发动', () => {
    it('adds skillActivate animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('技能发动', { player: 'P1', skillId: 'qinglong' }),
      ]);
      expect(result.animationQueue).toEqual([
        { type: '技能发动', player: 'P1', skillId: 'qinglong' },
      ]);
    });
  });

  // ─── gainCard / cardGained ───────────────────────────────

  describe('获得', () => {
    it('adds card to self hand', () => {
      const fe = setup();
      const card = cardInfo('c99', '桃');
      const result = reduceFrontend(fe, [
        makePlayerEvent('获得', {
          player: 'P1',
          cardId: 'c99',
          card,
          from: { zone: '弃牌堆' },
        }),
      ]);
      expect(result.view.self.hand).toHaveLength(4);
      expect(result.view.self.hand[3].id).toBe('c99');
    });

    it('increments handCount for others', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('获得', {
          player: 'P2',
          cardId: 'c99',
          from: { zone: '弃牌堆' },
        }),
      ]);
      expect(result.view.others.P2.handCount).toBe(2);
    });

    it('adds cardMove animation', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('获得', {
          player: 'P1',
          cardId: 'c99',
          card: cardInfo('c99'),
          from: { zone: '弃牌堆' },
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
        makePlayerEvent('造成伤害', { target: 'P1', amount: 1 }),
        makePlayerEvent('回复体力', { target: 'P1', amount: 1 }),
        makePlayerEvent('造成伤害', { target: 'P1', amount: 2 }),
        makePlayerEvent('设阶段', { phase: '弃牌' }),
      ]);
      expect(result.view.self.health).toBe(2);
      expect(result.view.turn.phase).toBe('弃牌');
      expect(result.animationQueue).toHaveLength(3);
    });
  });

  describe('unknown event type', () => {
    it('is silently skipped', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('someFutureEvent', { foo: 'bar' }),
      ]);
      expect(result.view).toEqual(fe.view);
      expect(result.animationQueue).toEqual([]);
    });
  });

  describe('immutability', () => {
    it('does not mutate the original state', () => {
      const fe = setup();
      const original = cloneFrontend(fe);
      reduceFrontend(fe, [
        makePlayerEvent('造成伤害', { target: 'P1', amount: 3 }),
        makePlayerEvent('设阶段', { phase: '摸牌' }),
      ]);
      expect(fe.view.self.health).toBe(original.view.self.health);
      expect(fe.view.turn.phase).toBe(original.view.turn.phase);
      expect(fe.animationQueue).toEqual([]);
    });
  });

  describe('cardsDiscarded alias', () => {
    it('handles cardsDiscarded event type like discard', () => {
      const fe = setup();
      const result = reduceFrontend(fe, [
        makePlayerEvent('弃置', { player: 'P1', cardIds: ['c2'] }),
      ]);
      expect(result.view.self.hand).toHaveLength(2);
      expect(result.view.self.hand.find(c => c.id === 'c2')).toBeUndefined();
    });
  });

  describe('cardGained alias', () => {
    it('handles cardGained event type like gainCard', () => {
      const fe = setup();
      const card = cardInfo('c88');
      const result = reduceFrontend(fe, [
        makePlayerEvent('获得', {
          player: 'P1',
          cardId: 'c88',
          card,
          from: { zone: '手牌', player: 'P2' },
        }),
      ]);
      expect(result.view.self.hand).toHaveLength(4);
    });
  });
});
