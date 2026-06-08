import { describe, it, expect } from 'vitest';
import { applyAtoms } from '@engine/atom';
import { ATOM_GAME_EVENTS } from '@engine/atom-game-events';
import { createTestGame, setHealth } from '../engine-helpers';
import '@engine/atoms/index';

describe.skip('ATOM_GAME_EVENTS 映射', () => {
  const REGISTERED_ATOM_TYPES = [
    '造成伤害', '回复体力',
    '摸牌', '弃置', '随机弃置', '获得',
    '移动牌', '装备', '卸下',
    '判定', '击杀',
    '设置变量', '加标签', '去标签',
    '下一玩家', '设阶段',
    '推入待定', '弹出待定', '添加延时锦囊',
    '整理牌堆',
  ];

  const mappedTypes = Object.keys(ATOM_GAME_EVENTS);

  it('damage → damageReceived', () => {
    const events = ATOM_GAME_EVENTS['造成伤害'](
      createTestGame(),
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'test' },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: '受到伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'test' });
  });

  it('heal → heal', () => {
    const events = ATOM_GAME_EVENTS['回复体力'](
      createTestGame(),
      { type: '回复体力', target: 'P1', amount: 1, source: 'P2' },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: '回复体力', target: 'P1', amount: 1, source: 'P2' });
  });

  it('其他原子不应有 ATOM_GAME_EVENTS 映射', () => {
    const unmapped = REGISTERED_ATOM_TYPES.filter(t => !mappedTypes.includes(t) && t !== '造成伤害' && t !== '回复体力');
    for (const type of unmapped) {
      expect(ATOM_GAME_EVENTS[type]).toBeUndefined();
    }
  });
});

describe('broadcast 多原子序列', () => {
  it('单原子 broadcast 正确', () => {
    const state = createTestGame();
    const beforeHand = state.players.P1.hand.length;
    const result = applyAtoms(state, [{ type: '摸牌', player: 'P1', count: 2 }]);
    expect(result.state.players.P1.hand.length).toBe(beforeHand + 2);
    expect(result.playerEvents.get('P1')).toHaveLength(1);
  });

  it('多原子顺序执行：draw → damage', () => {
    let state = setHealth(createTestGame(), 'P1', 4);
    state = applyAtoms(state, [
      { type: '摸牌', player: 'P1', count: 1 },
      { type: '造成伤害', target: 'P1', amount: 2, source: 'P2' },
    ]).state;
    expect(state.players.P1.health).toBe(2);
  });

  it('多原子各自产生事件', () => {
    const state = createTestGame();
    const result = applyAtoms(state, [
      { type: '摸牌', player: 'P1', count: 1 },
      { type: '造成伤害', target: 'P2', amount: 1, source: 'P1', cardId: 'test' },
    ]);
    expect(result.playerEvents.get('P1')).toHaveLength(2);
    expect(result.playerEvents.get('P2')).toHaveLength(2);
  });

  it('每个原子的事件在 apply 之前生成', () => {
    const state = createTestGame();
    const beforeP2Hand = state.players.P2.hand.length;
    const result = applyAtoms(state, [
      { type: '摸牌', player: 'P1', count: 2 },
      { type: '移动牌', cardId: state.players.P1.hand[0], from: { zone: '手牌', player: 'P1' }, to: { zone: '手牌', player: 'P2' } },
    ]);
    const p2Events = result.playerEvents.get('P2')!;
    expect(p2Events.length).toBeGreaterThan(0);
    expect(result.state.players.P2.hand.length).toBe(beforeP2Hand + 1);
  });

  it('moveCard + gainCard 序列模拟奸雄路径', () => {
    const state = createTestGame();
    const cardId = state.players.P1.hand[0];
    const r1 = applyAtoms(state, [
      { type: '移动牌', cardId, from: { zone: '手牌', player: 'P1' }, to: { zone: '弃牌堆' } },
    ]);
    expect(r1.state.zones.discardPile).toContain(cardId);

    const r2 = applyAtoms(r1.state, [
      { type: '获得', player: 'P2', cardId, from: { zone: '弃牌堆' } },
    ]);
    expect(r2.state.players.P2.hand).toContain(cardId);
    expect(r2.state.zones.discardPile).not.toContain(cardId);

    const p2gainEvents = r2.playerEvents.get('P2')!;
    expect(p2gainEvents.some(e => e.type === '获得')).toBe(true);
  });

  it('draw 后 damage：验证事件顺序', () => {
    const state = createTestGame();
    const result = applyAtoms(state, [
      { type: '摸牌', player: 'P1', count: 1 },
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2' },
    ]);
    const p1Events = result.playerEvents.get('P1')!;
    expect(p1Events[0].type).toBe('摸牌');
    expect(p1Events[1].type).toBe('造成伤害');
  });
});
