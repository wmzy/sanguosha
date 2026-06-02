import { describe, it, expect } from 'vitest';
import { broadcast } from '@engine/v2/atom';
import { ATOM_GAME_EVENTS } from '@engine/v2/atom-game-events';
import { createTestGame, setHealth } from '../setup';
import '@engine/v2/atoms/index';

describe('ATOM_GAME_EVENTS 映射', () => {
  const REGISTERED_ATOM_TYPES = [
    'damage', 'heal',
    'draw', 'discard', 'discardRandom', 'gainCard',
    'moveCard', 'equip', 'unequip',
    'judge', 'kill',
    'setVar', 'addTag', 'removeTag',
    'nextPlayer', 'setPhase',
    'pushPending', 'popPending', 'addPendingTrick',
    'rearrangeDeck',
  ];

  const mappedTypes = Object.keys(ATOM_GAME_EVENTS);

  it('damage → damageReceived', () => {
    const events = ATOM_GAME_EVENTS['damage'](
      createTestGame(),
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', cardId: 'test' },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'damageReceived', target: 'P1', amount: 1, source: 'P2', cardId: 'test' });
  });

  it('heal → heal', () => {
    const events = ATOM_GAME_EVENTS['heal'](
      createTestGame(),
      { type: 'heal', target: 'P1', amount: 1, source: 'P2' },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'heal', target: 'P1', amount: 1, source: 'P2' });
  });

  it('其他原子不应有 ATOM_GAME_EVENTS 映射', () => {
    const unmapped = REGISTERED_ATOM_TYPES.filter(t => !mappedTypes.includes(t) && t !== 'damage' && t !== 'heal');
    for (const type of unmapped) {
      expect(ATOM_GAME_EVENTS[type]).toBeUndefined();
    }
  });
});

describe('broadcast 多原子序列', () => {
  it('单原子 broadcast 正确', () => {
    const state = createTestGame();
    const beforeHand = state.players.P1.hand.length;
    const result = broadcast(state, [{ type: 'draw', player: 'P1', count: 2 }]);
    expect(result.state.players.P1.hand.length).toBe(beforeHand + 2);
    expect(result.playerEvents.get('P1')).toHaveLength(1);
  });

  it('多原子顺序执行：draw → damage', () => {
    let state = setHealth(createTestGame(), 'P1', 4);
    state = broadcast(state, [
      { type: 'draw', player: 'P1', count: 1 },
      { type: 'damage', target: 'P1', amount: 2, source: 'P2' },
    ]).state;
    expect(state.players.P1.health).toBe(2);
  });

  it('多原子各自产生事件', () => {
    const state = createTestGame();
    const result = broadcast(state, [
      { type: 'draw', player: 'P1', count: 1 },
      { type: 'damage', target: 'P2', amount: 1, source: 'P1', cardId: 'test' },
    ]);
    expect(result.playerEvents.get('P1')).toHaveLength(2);
    expect(result.playerEvents.get('P2')).toHaveLength(2);
  });

  it('每个原子的事件在 apply 之前生成', () => {
    const state = createTestGame();
    const beforeP2Hand = state.players.P2.hand.length;
    const result = broadcast(state, [
      { type: 'draw', player: 'P1', count: 2 },
      { type: 'moveCard', cardId: state.players.P1.hand[0], from: { zone: 'hand', player: 'P1' }, to: { zone: 'hand', player: 'P2' } },
    ]);
    const p2Events = result.playerEvents.get('P2')!;
    expect(p2Events.length).toBeGreaterThan(0);
    expect(result.state.players.P2.hand.length).toBe(beforeP2Hand + 1);
  });

  it('moveCard + gainCard 序列模拟奸雄路径', () => {
    const state = createTestGame();
    const cardId = state.players.P1.hand[0];
    const r1 = broadcast(state, [
      { type: 'moveCard', cardId, from: { zone: 'hand', player: 'P1' }, to: { zone: 'discardPile' } },
    ]);
    expect(r1.state.zones.discardPile).toContain(cardId);

    const r2 = broadcast(r1.state, [
      { type: 'gainCard', player: 'P2', cardId, from: { zone: 'discardPile' } },
    ]);
    expect(r2.state.players.P2.hand).toContain(cardId);
    expect(r2.state.zones.discardPile).not.toContain(cardId);

    const p2gainEvents = r2.playerEvents.get('P2')!;
    expect(p2gainEvents.some(e => e.type === 'cardGained')).toBe(true);
  });

  it('draw 后 damage：验证事件顺序', () => {
    const state = createTestGame();
    const result = broadcast(state, [
      { type: 'draw', player: 'P1', count: 1 },
      { type: 'damage', target: 'P1', amount: 1, source: 'P2' },
    ]);
    const p1Events = result.playerEvents.get('P1')!;
    expect(p1Events[0].type).toBe('draw');
    expect(p1Events[1].type).toBe('damage');
  });
});
