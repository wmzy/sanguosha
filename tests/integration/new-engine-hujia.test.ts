// tests/integration/new-engine-hujia.test.ts
// 集成测试 2: 新顶层 API(dispatch / rebootstrap) + 武将技能 护甲(锁定被动)
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch, rebootstrap, resetForTest } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function buildInitialState(): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true, hand: ['c1'], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: ['护甲'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: { c1: slash },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('新 ENGINE-DESIGN 顶层 API — 护甲(曹操·锁定被动)', () => {
  let state: GameState;

  beforeEach(async () => {
    resetForTest();
    state = buildInitialState();
    await rebootstrap(state);
  });

  it('受到黑色【杀】 → 扣 0 血(护甲吸收)', async () => {
    await dispatch(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: 'c1', targets: [1] }, baseSeq: 0,
    });
    const p2 = state.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(4);
    expect(p2.alive).toBe(true);
  });
});
