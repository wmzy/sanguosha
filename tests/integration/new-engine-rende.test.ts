// tests/integration/new-engine-rende.test.ts
// 集成测试 3: 新顶层 API(dispatch / registerSkillsFromState) + 武将技能 仁德(刘备)
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch, registerSkillsFromState, resetForTest } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function buildInitialState(): GameState {
  const c1: Card = { id: 'c1', name: '桃', suit: '♥', rank: 'A', type: '基本牌' };
  const c2: Card = { id: 'c2', name: '桃', suit: '♥', rank: '2', type: '基本牌' };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '刘备', health: 3, maxHealth: 4, alive: true, hand: ['c1', 'c2'], equipment: {}, skills: ['仁德'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '关羽', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: { c1, c2 },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('新 ENGINE-DESIGN 顶层 API — 仁德(刘备)', () => {
  let state: GameState;

  beforeEach(async () => {
    resetForTest();
    state = buildInitialState();
    await registerSkillsFromState(state);
  });

  it('给 1 人 2 张牌(单帧) → 刘备回复 1 血', async () => {
    await dispatch(state, {
      skillId: '仁德', actionType: 'use', ownerId: 0,
      params: {
        targets: [
          { target: 1, cardIds: ['c1', 'c2'] },
        ],
      },
      baseSeq: 0,
    });
    const p1 = state.players.find(p => p.name === 'P1')!;
    expect(p1.health).toBe(4);
    const p2 = state.players.find(p => p.name === 'P2')!;
    expect(p2.hand).toContain('c1');
    expect(p2.hand).toContain('c2');
  });
});
