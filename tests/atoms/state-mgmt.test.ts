import { describe, it, expect } from 'vitest';
import { applyAtom } from '@engine/atom';
import type { GameState, PendingAction } from '@engine/types';
import { createTestGame } from '../engine-helpers';
import '@engine/atoms/index';

describe('discard', () => {
  it('apply: 弃掉指定手牌', () => {
    const state = createTestGame();
    const cardId = state.players.P1.hand[0];
    const result = applyAtom(state, { type: 'discard', player: 'P1', cardIds: [cardId] });
    expect(result.players.P1.hand).not.toContain(cardId);
    expect(result.zones.discardPile).toContain(cardId);
  });

  it('apply: 弃多张牌', () => {
    const state = createTestGame();
    const cards = state.players.P1.hand.slice(0, 2);
    const result = applyAtom(state, { type: 'discard', player: 'P1', cardIds: cards });
    cards.forEach(id => {
      expect(result.players.P1.hand).not.toContain(id);
      expect(result.zones.discardPile).toContain(id);
    });
  });
});

describe('discardRandom', () => {
  it('apply: 随机弃掉指定张数', () => {
    const state = createTestGame();
    const before = state.players.P1.hand.length;
    const result = applyAtom(state, { type: 'discardRandom', player: 'P1', count: 2, from: 'hand' });
    expect(result.players.P1.hand.length).toBe(before - 2);
    expect(result.zones.discardPile.length).toBe(state.zones.discardPile.length + 2);
  });
});

function makeEquipCard(state: GameState, name: string, subtype: string): { state: GameState; cardId: string } {
  const id = `test-${name}`;
  const newState = {
    ...state,
    cardMap: { ...state.cardMap, [id]: { id, name, type: '装备牌' as const, subtype: subtype as '武器' | '防具' | '马', suit: '♠' as const, rank: 'A' as const, description: '' } },
    players: { ...state.players, P1: { ...state.players.P1, hand: [...state.players.P1.hand, id] } },
  } as GameState;
  return { state: newState, cardId: id };
}

describe('equip', () => {
  it('apply: 装备到手牌移至装备区', () => {
    const { state, cardId } = makeEquipCard(createTestGame(), '青龙偃月刀', '武器');
    const result = applyAtom(state, { type: 'equip', player: 'P1', cardId });
    expect(result.players.P1.hand).not.toContain(cardId);
    expect(result.players.P1.equipment.weapon).toBe(cardId);
  });

  it('apply: 替换已有装备（旧装备进弃牌堆）', () => {
    const { state: s1, cardId: oldId } = makeEquipCard(createTestGame(), '青龙偃月刀', '武器');
    const equipped = applyAtom(s1, { type: 'equip', player: 'P1', cardId: oldId });

    const { state: s2, cardId: newId } = makeEquipCard(equipped, '丈八蛇矛', '武器');
    const result = applyAtom(s2, { type: 'equip', player: 'P1', cardId: newId });
    expect(result.players.P1.equipment.weapon).toBe(newId);
    expect(result.zones.discardPile).toContain(oldId);
  });
});

describe('var/setVar', () => {
  it('setVar: 设置玩家变量', () => {
    const state = createTestGame();
    const result = applyAtom(state, { type: 'setVar', player: 'P1', key: 'testKey', value: 42 });
    expect(result.players.P1.vars.testKey).toBe(42);
  });

  it('setVar: 多次设置覆盖', () => {
    const state = createTestGame();
    const r1 = applyAtom(state, { type: 'setVar', player: 'P1', key: 'k', value: 'a' });
    const r2 = applyAtom(r1, { type: 'setVar', player: 'P1', key: 'k', value: 'b' });
    expect(r2.players.P1.vars.k).toBe('b');
  });
});

describe('addTag', () => {
  it('addTag: 添加标签', () => {
    const state = createTestGame();
    const result = applyAtom(state, { type: 'addTag', player: 'P1', tag: 'testTag' });
    expect(result.players.P1.tags).toContain('testTag');
  });
});

describe('removeTag', () => {
  it('removeTag: 移除标签', () => {
    const state = createTestGame();
    const tagged = applyAtom(state, { type: 'addTag', player: 'P1', tag: 'testTag' });
    const result = applyAtom(tagged, { type: 'removeTag', player: 'P1', tag: 'testTag' });
    expect(result.players.P1.tags).not.toContain('testTag');
  });
});

describe('turn/phase', () => {
  it('nextPlayer: 切换到下一个玩家', () => {
    const state = createTestGame();
    const result = applyAtom(state, { type: 'nextPlayer' });
    expect(result.currentPlayer).toBe('P2');
  });

  it('setPhase: 切换阶段', () => {
    const state = createTestGame();
    const result = applyAtom(state, { type: 'setPhase', phase: '出牌' });
    expect(result.phase).toBe('出牌');
  });
});

describe('rearrangeDeck', () => {
  it('apply: topCardIds 出现在牌堆顶', () => {
    const state = createTestGame();
    const cardId = state.zones.deck[1];
    const result = applyAtom(state, {
      type: 'rearrangeDeck',
      player: 'P1',
      topCardIds: [cardId],
      bottomCardIds: [],
    });
    expect(result.zones.deck[0]).toBe(cardId);
  });

  it('apply: bottomCardIds 出现在牌堆底', () => {
    const state = createTestGame();
    const cardId = state.zones.deck[0];
    const result = applyAtom(state, {
      type: 'rearrangeDeck',
      player: 'P1',
      topCardIds: [],
      bottomCardIds: [cardId],
    });
    expect(result.zones.deck[result.zones.deck.length - 1]).toBe(cardId);
  });
});

describe('pending/pendingTrick', () => {
  it('pushPending: 设置 pending', () => {
    const state = createTestGame();
    const action: PendingAction = { id: 'test-pending', type: 'playPhase', player: 'P1', timeout: 0, deadline: 0, onTimeout: { type: 'endTurn' as const, player: 'P1' } };
    const result = applyAtom(state, { type: 'pushPending', action });
    expect(result.pending).toBeDefined();
  });

  it('popPending: 清除 pending', () => {
    const state = createTestGame();
    const action: PendingAction = { id: 'test-pending', type: 'playPhase', player: 'P1', timeout: 0, deadline: 0, onTimeout: { type: 'endTurn' as const, player: 'P1' } };
    const pushed = applyAtom(state, { type: 'pushPending', action });
    const result = applyAtom(pushed, { type: 'popPending' });
    expect(result.pending).toBeNull();
  });

  it('addPendingTrick: 添加延迟锦囊', () => {
    const state = createTestGame();
    const trick = { name: '乐不思蜀', source: 'P1', card: { id: 'test-le', name: '乐不思蜀', type: '锦囊牌' as const, subtype: '锦囊' as const, suit: '♠' as const, rank: 'A' as const, description: '' } };
    const result = applyAtom(state, { type: 'addPendingTrick', player: 'P2', trick });
    expect(result.players.P2.pendingTricks).toHaveLength(1);
    expect(result.players.P2.pendingTricks[0].name).toBe('乐不思蜀');
  });
});
