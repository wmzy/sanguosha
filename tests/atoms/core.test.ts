import { describe, it, expect } from 'vitest';
import { applyAtom, atomToEvents } from '@engine/atom';
import { ATOM_GAME_EVENTS } from '@engine/atom-game-events';
import type { GameState, GameEvent } from '@engine/types';
import { createTestGame, setHealth } from '../engine-helpers';
import '@engine/atoms/index';

function asGameEvent<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }> {
  const e = events[0];
  if (e?.type !== type) throw new Error(`Expected event type ${type}, got ${e?.type}`);
  return e as Extract<GameEvent, { type: T }>;
}

function firstCardId(state: GameState, player: string): string {
  return state.players[player].hand[0];
}

describe.skip('移动牌', () => {
  it('apply: hand → hand', () => {
    const state = createTestGame();
    const cardId = firstCardId(state, 'P1');
    const result = applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: 'P1' },
      to: { zone: '手牌', player: 'P2' },
    });
    expect(result.players.P1.hand).not.toContain(cardId);
    expect(result.players.P2.hand).toContain(cardId);
  });

  it('apply: hand → discardPile', () => {
    const state = createTestGame();
    const cardId = firstCardId(state, 'P1');
    const result = applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: 'P1' },
      to: { zone: '弃牌堆' },
    });
    expect(result.players.P1.hand).not.toContain(cardId);
    expect(result.zones.discardPile).toContain(cardId);
  });

  it('apply: discardPile → hand', () => {
    const state = createTestGame();
    const cardId = firstCardId(state, 'P1');
    const discarded = applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: 'P1' },
      to: { zone: '弃牌堆' },
    });
    const result = applyAtom(discarded, {
      type: '移动牌',
      cardId,
      from: { zone: '弃牌堆' },
      to: { zone: '手牌', player: 'P2' },
    });
    expect(result.zones.discardPile).not.toContain(cardId);
    expect(result.players.P2.hand).toContain(cardId);
  });

  it('toEvents: 生成 cardMoved 事件', () => {
    const state = createTestGame();
    const cardId = firstCardId(state, 'P1');
    const [serverEvent, playerMap, defaultEvent] = atomToEvents(state, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: 'P1' },
      to: { zone: '弃牌堆' },
    });
    expect(serverEvent.type).toBe('移动牌');
    expect((serverEvent.payload as Record<string, unknown>).cardId).toBe(cardId);
    expect(defaultEvent!.type).toBe('移动牌');
    expect(playerMap.size).toBe(0);
  });
});

describe('造成伤害', () => {
  it('apply: 减少目标体力', () => {
    const state = setHealth(createTestGame(), 'P1', 4);
    const result = applyAtom(state, {
      type: '造成伤害',
      target: 'P1',
      amount: 1,
      source: 'P2',
    });
    expect(result.players.P1.health).toBe(3);
  });

  it('apply: 多次伤害累加', () => {
    const state = setHealth(createTestGame(), 'P1', 4);
    const once = applyAtom(state, { type: '造成伤害', target: 'P1', amount: 1, source: 'P2' });
    const twice = applyAtom(once, { type: '造成伤害', target: 'P1', amount: 2, source: 'P2' });
    expect(twice.players.P1.health).toBe(1);
  });

  it('toEvents: 生成 damage 事件带 cardId', () => {
    const state = createTestGame();
    const [serverEvent] = atomToEvents(state, {
      type: '造成伤害',
      target: 'P1',
      amount: 1,
      source: 'P2',
      cardId: 'test-card',
    });
    expect(serverEvent.type).toBe('造成伤害');
    const payload = serverEvent.payload as Record<string, unknown>;
    expect(payload.target).toBe('P1');
    expect(payload.amount).toBe(1);
    expect(payload.source).toBe('P2');
    expect(payload.cardId).toBe('test-card');
  });

  it('toEvents: 不含 cardId', () => {
    const state = createTestGame();
    const [serverEvent] = atomToEvents(state, {
      type: '造成伤害',
      target: 'P1',
      amount: 1,
      source: 'P2',
    });
    const payload = serverEvent.payload as Record<string, unknown>;
    expect(payload.cardId).toBeUndefined();
  });

  it('ATOM_GAME_EVENTS: damage → damageReceived', () => {
    const state = createTestGame();
    const events = ATOM_GAME_EVENTS['造成伤害'](state, {
      type: '造成伤害',
      target: 'P1',
      amount: 1,
      source: 'P2',
      cardId: 'test-card',
    });
    expect(events).toHaveLength(1);
    const e = asGameEvent(events, '受到伤害');
    expect(e.target).toBe('P1');
    expect(e.cardId).toBe('test-card');
  });
});

describe('回复体力', () => {
  it('apply: 增加目标体力', () => {
    const state = setHealth(createTestGame(), 'P1', 2);
    const result = applyAtom(state, { type: '回复体力', target: 'P1', amount: 1 });
    expect(result.players.P1.health).toBe(3);
  });

  it('apply: 不超过最大体力', () => {
    const state = setHealth(createTestGame(), 'P1', 2);
    const result = applyAtom(state, { type: '回复体力', target: 'P1', amount: 3 });
    expect(result.players.P1.health).toBe(result.players.P1.maxHealth);
  });

  it('toEvents: 生成 heal 事件', () => {
    const state = createTestGame();
    const [serverEvent] = atomToEvents(state, { type: '回复体力', target: 'P1', amount: 1 });
    expect(serverEvent.type).toBe('回复体力');
    const payload = serverEvent.payload as Record<string, unknown>;
    expect(payload.target).toBe('P1');
    expect(payload.amount).toBe(1);
  });

  it('ATOM_GAME_EVENTS: heal → heal', () => {
    const state = createTestGame();
    const events = ATOM_GAME_EVENTS['回复体力'](state, { type: '回复体力', target: 'P1', amount: 1, source: 'P2' });
    expect(events).toHaveLength(1);
    const e = asGameEvent(events, '回复体力');
    expect(e.source).toBe('P2');
  });
});

describe('摸牌', () => {
  it('apply: 从牌堆顶摸指定张数', () => {
    const state = createTestGame();
    const beforeHand = state.players.P1.hand.length;
    const beforeDeck = state.zones.deck.length;
    const result = applyAtom(state, { type: '摸牌', player: 'P1', count: 2 });
    expect(result.players.P1.hand.length).toBe(beforeHand + 2);
    expect(result.zones.deck.length).toBe(beforeDeck - 2);
    expect(result.players.P1.hand.slice(-2).every(id => !state.players.P1.hand.includes(id))).toBe(true);
  });

  it('apply: 摸 0 张无变化', () => {
    const state = createTestGame();
    const result = applyAtom(state, { type: '摸牌', player: 'P1', count: 0 });
    expect(result).toEqual(state);
  });

  it('apply: 牌堆不够时洗弃牌堆', () => {
    const state = createTestGame();
    const allDeck = [...state.zones.deck];
    const emptied: GameState = { ...state, zones: { deck: [], discardPile: allDeck } };
    const result = applyAtom(emptied, { type: '摸牌', player: 'P1', count: 3 });
    expect(result.players.P1.hand.length).toBeGreaterThan(state.players.P1.hand.length);
    expect(result.zones.deck.length).toBeGreaterThan(0);
    expect(result.zones.discardPile.length).toBe(0);
  });

  it('toEvents: 摸牌者看到牌内容，其他人只看到数量', () => {
    const state = createTestGame();
    const [, playerMap, defaultEvent] = atomToEvents(state, { type: '摸牌', player: 'P1', count: 2 });
    const ownerEvent = playerMap.get('P1');
    expect(ownerEvent).toBeDefined();
    expect((ownerEvent!.payload as Record<string, unknown>).cards).toBeDefined();
    expect(defaultEvent!.type).toBe('摸牌');
    expect((defaultEvent!.payload as Record<string, unknown>).cards).toBeUndefined();
  });
});

describe('获得', () => {
  it('apply: 从弃牌堆获取指定牌到手牌', () => {
    const state = createTestGame();
    const cardId = firstCardId(state, 'P1');
    const discarded = applyAtom(state, {
      type: '移动牌', cardId,
      from: { zone: '手牌', player: 'P1' },
      to: { zone: '弃牌堆' },
    });
    const result = applyAtom(discarded, {
      type: '获得', player: 'P2',
      cardId,
      from: { zone: '弃牌堆' },
    });
    expect(result.players.P2.hand).toContain(cardId);
    expect(result.zones.discardPile).not.toContain(cardId);
  });

  it('toEvents: 获得者看到卡牌详情，其他人只看到 cardId', () => {
    const state = createTestGame();
    const cardId = firstCardId(state, 'P1');
    const [, playerMap, defaultEvent] = atomToEvents(state, {
      type: '获得', player: 'P2',
      cardId,
      from: { zone: '弃牌堆' },
    });
    const ownerEvent = playerMap.get('P2');
    expect(ownerEvent).toBeDefined();
    expect((ownerEvent!.payload as Record<string, unknown>).card).toBeDefined();
    expect((defaultEvent!.payload as Record<string, unknown>).card).toBeUndefined();
  });
});
