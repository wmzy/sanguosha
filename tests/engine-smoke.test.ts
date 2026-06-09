// tests/engine-smoke.test.ts
// 杀→出闪→不掉血 流程
import { describe, it, expect } from 'vitest';
import '../src/engine/atoms';  // 注册 atom
import { applyAtom } from '../src/engine/atom';
import type { GameState } from '../src/engine/types';

const seedState = (): GameState => {
  const card1 = { id: 'c1', name: '杀', suit: '♠', rank: 1, type: '基本牌' as const };
  const card2 = { id: 'c2', name: '杀', suit: '♠', rank: 2, type: '基本牌' as const };
  return {
    players: [
      { index: 0, name: 'P1', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: ['c1'], equipment: {}, skills: [], vars: {}, marks: [] },
      { index: 1, name: 'P2', character: '刘备', health: 4, maxHealth: 4, alive: true, hand: ['c2'], equipment: {}, skills: [], vars: {}, marks: [] },
    ],
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    zones: { deck: [], discardPile: [], processing: [] },
    settlementStack: [],
    cardMap: { c1: card1, c2: card2 },
    rngSeed: 1,
    marks: [],
    localVars: {},
    meta: { gameId: 'g1', createdAt: 0 },
    seq: 0,
    startedAt: 0,
    actionLog: [],
  };
};

describe('engine smoke', () => {
  it('造成伤害 扣血', () => {
    const state = seedState();
    const next = applyAtom(state, { type: '造成伤害', target: 'P2', amount: 1, source: 'P1' });
    const p2 = next.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
    expect(p2.alive).toBe(true);
  });

  it('造成伤害 到 0 血 → alive=false', () => {
    const state = seedState();
    const next = applyAtom(state, { type: '造成伤害', target: 'P2', amount: 4, source: 'P1' });
    const p2 = next.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(0);
    expect(p2.alive).toBe(false);
  });

  it('摸牌', () => {
    const state = seedState();
    state.zones.deck = ['d1', 'd2', 'd3'];
    const next = applyAtom(state, { type: '摸牌', player: 'P1', count: 2 });
    expect(next.players[0].hand).toEqual(['c1', 'd3', 'd2']);
    expect(next.zones.deck).toEqual(['d1']);
  });

  it('移动牌 手牌→处理区→弃牌堆', () => {
    const state = seedState();
    let s = applyAtom(state, { type: '移动牌', cardId: 'c1', from: { zone: '手牌', player: 'P1' }, to: { zone: '处理区' } });
    s = applyAtom(s, { type: '移动牌', cardId: 'c1', from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
    expect(s.players[0].hand).toEqual([]);
    expect(s.zones.processing).toEqual([]);
    expect(s.zones.discardPile).toEqual(['c1']);
  });
});