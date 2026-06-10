// tests/integration/new-engine-rende.test.ts
// 集成测试 3: 新 ENGINE-DESIGN createEngine + 武将技能 仁德(刘备)
import { describe, it, expect, beforeEach } from 'vitest';
import { createEngine } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';

function buildInitialState(): GameState {
  const c1: Card = { id: 'c1', name: '桃', suit: '♥', rank: 1, type: '基本牌' };
  const c2: Card = { id: 'c2', name: '桃', suit: '♥', rank: 2, type: '基本牌' };
  return {
    players: [
      { index: 0, name: 'P1', character: '刘备', health: 3, maxHealth: 4, alive: true, hand: ['c1', 'c2'], equipment: {}, skills: ['仁德'], vars: {}, marks: [], pendingTricks: [] },
      { index: 1, name: 'P2', character: '关羽', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [] },
    ],
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    zones: { deck: [], discardPile: [], processing: [] },
    settlementStack: [],
    cardMap: { c1, c2 },
    rngSeed: 1,
    marks: [],
    localVars: {},
    meta: { gameId: 'g1', createdAt: 0 },
    seq: 0,
    startedAt: 0,
    actionLog: [],
  };
}

describe('新 ENGINE-DESIGN createEngine — 仁德(刘备)', () => {
  let state: GameState;

  beforeEach(() => {
    state = buildInitialState();
    const engine = createEngine();
    engine.resetForTest();
    state = engine.bootstrap(state);
  });

  it('给 1 人 2 张牌(单帧) → 刘备回复 1 血', async () => {
    const engine = createEngine();
    const next = await engine.dispatch(state, {
      skillId: '仁德', actionType: 'use', ownerId: 'P1',
      params: {
        targets: [
          { target: 'P2', cardIds: ['c1', 'c2'] },
        ],
      },
      baseSeq: 0,
    });
    const p1 = next.players.find(p => p.name === 'P1')!;
    expect(p1.health).toBe(4);
    const p2 = next.players.find(p => p.name === 'P2')!;
    expect(p2.hand).toContain('c1');
    expect(p2.hand).toContain('c2');
  });
});
