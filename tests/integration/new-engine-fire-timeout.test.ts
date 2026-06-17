// tests/integration/new-engine-fire-timeout.test.ts
// 引擎 fireTimeout(state) 单元测试(归 core 项目)
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch, fireTimeout, registerSkillsFromState, resetForTest } from '../../src/engine/create-engine';
import { fireTimeoutAndWait,  dispatchAndWait } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function buildInitialState(): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  return createGameState({
    players: [
      { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true,
        hand: ['c1'], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '反贼', health: 4, maxHealth: 4, alive: true,
        hand: [], equipment: {}, skills: ['闪'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: { c1: slash },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('fireTimeout(state)', () => {
  let state: GameState;
  beforeEach(async () => {
    resetForTest();
    state = buildInitialState();
    await registerSkillsFromState(state);
  });

  it('无 pending 时调用:无副作用,state 不变', async () => {
    const beforeSeq = state.seq;
    await fireTimeoutAndWait(state);
    expect(state.seq).toBe(beforeSeq);
  });

  it('有 pending(询问闪)时调用:触发 onTimeout → pending 清空 → P2 扣 1 血', async () => {
    await dispatchAndWait(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: 'c1', targets: [1] }, baseSeq: 0,
    });
    expect(state.pendingSlots.size).toBeGreaterThan(0);

    await fireTimeoutAndWait(state);
    expect(state.pendingSlots.size).toBe(0);
    const p2 = state.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
  });
});
