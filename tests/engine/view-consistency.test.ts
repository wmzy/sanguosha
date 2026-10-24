import { describe, expect, it } from 'vitest';
import { buildView } from '../../src/engine/index';
import { createGameState, type GameView } from '../../src/engine/types';
import { assertViewConsistency } from '../engine-harness';

function makeState() {
  return createGameState({
    players: [{
      index: 0, name: '玩家', character: '刘备', faction: '蜀',
      health: 4, maxHealth: 4, alive: true, hand: [], equipment: {},
      pendingTricks: [], skills: [], vars: {}, marks: [], tags: [],
    }],
    cardMap: {},
  });
}

describe('视图一致性检查覆盖玩家决策字段', () => {
  const mutations: Array<[string, (view: GameView) => void]> = [
    ['turnUsage', (view) => { view.players[0].turnUsage = { '杀/usedCount': 99 }; }],
    ['tags', (view) => { view.players[0].tags = ['奇才/无距离限制']; }],
    ['faction', (view) => { view.players[0].faction = '魏'; }],
    ['health', (view) => { view.players[0].health = 1; }],
    ['settlementStack', (view) => {
      view.settlementStack.push({ skillId: '杀', from: 0, params: {}, cards: [], cancelled: false });
    }],
  ];

  it.each(mutations)('检测 %s 的增量投影漂移', (field, mutate) => {
    const state = makeState();
    const view = structuredClone(buildView(state, 0));
    mutate(view);
    expect(() => assertViewConsistency(view, state, 0)).toThrow(field);
  });

  it('仅排除独立日志来源和实时截止时间', () => {
    const state = makeState();
    const view = structuredClone(buildView(state, 0));
    view.log = [{ time: 123, player: 0, text: '公开战报' }];
    view.deadline = 123456;
    view.deadlineTotalMs = 30000;
    assertViewConsistency(view, state, 0);
    view.players[0].handCount = 1;
    expect(() => assertViewConsistency(view, state, 0)).toThrow('handCount');
  });
});
