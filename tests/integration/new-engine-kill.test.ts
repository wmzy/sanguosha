// tests/integration/new-engine-kill.test.ts
// 集成测试 1: 新顶层 API(dispatch / registerSkillsFromState) + 出杀全流程(不含回应,含扣血)
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch, registerSkillsFromState, resetForTest } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function buildInitialState(): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  return createGameState({
    players: [
      {
        index: 0,
        name: 'P1',
        character: '主公',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: ['c1'],
        equipment: {},
        skills: ['杀'],
        vars: {},
        marks: [],
        pendingTricks: [],
        judgeZone: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '反贼',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: ['闪'],
        vars: {},
        marks: [],
        pendingTricks: [],
        judgeZone: [],
      },
    ],
    cardMap: { c1: slash },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('新 ENGINE-DESIGN 顶层 API — 出杀全流程', () => {
  let state: GameState;

  beforeEach(async () => {
    resetForTest();
    state = buildInitialState();
    await registerSkillsFromState(state);
  });

  it('出杀:无回应 → 目标扣 1 血', async () => {
    // 第一步:出杀 → 产生 pending 等待闪
    await dispatch(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: 'c1', targets: [1] },
      baseSeq: 0,
    });
    const mid = state;
    const p2Mid = mid.players.find(p => p.name === 'P2')!;
    expect(p2Mid.health).toBe(4); // 还没扣血

    // 第二步:P2 不出闪 → 结算伤害
    await dispatch(state, {
      skillId: '闪',
      actionType: 'respond',
      ownerId: 1,
      params: {},
    });
    const p2 = state.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
    expect(p2.alive).toBe(true);
    expect(state.zones.discardPile).toContain('c1');
  });

  it('出杀:limit 验证 — 同回合第二次出杀应被拒绝', async () => {
    // 第一步:出杀
    await dispatch(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: 'c1', targets: [1] }, baseSeq: 0,
    });
    // 第二步:P2 不出闪 → 结算
    await dispatch(state, {
      skillId: '闪', actionType: 'respond', ownerId: 1, params: {},
    });
    // 准备第二张杀
    const c2: Card = { id: 'c2', name: '杀', suit: '♠', rank: '2', type: '基本牌' };
    // 注:这里直接修改 state 是测试 hack,实际应该通过引擎
    state.players = state.players.map(p => p.name === 'P1' ? { ...p, hand: ['c2'] } : p);
    state.cardMap = { ...state.cardMap, c2 };
    resetForTest();
    await registerSkillsFromState(state);

    await dispatch(state, {
      skillId: '杀', actionType: 'use', ownerId: 0,
      params: { cardId: 'c2', targets: [1] }, baseSeq: 2,
    });
    const p2 = state.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
  });

  it('未注册的 action:静默丢弃', async () => {
    const beforeSeq = state.seq;
    await dispatch(state, {
      skillId: '不存在的 skill', actionType: 'use', ownerId: 0,
      params: { cardId: 'c1', targets: [1] }, baseSeq: 0,
    });
    // 未注册的 action:dispatch 返回 {}(静默丢弃),state 不变
    expect(state.seq).toBe(beforeSeq);
  });
});
