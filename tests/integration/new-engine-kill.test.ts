// tests/integration/new-engine-kill.test.ts
// 集成测试 1: 新 ENGINE-DESIGN createEngine + 出杀全流程(不含回应,含扣血)
import { describe, it, expect, beforeEach } from 'vitest';
import { createEngine } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';

function buildInitialState(): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', rank: 1, type: '基本牌' };
  return {
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
      },
    ],
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    zones: { deck: [], discardPile: [], processing: [] },
    settlementStack: [],
    cardMap: { c1: slash },
    rngSeed: 1,
    marks: [],
    localVars: {},
    meta: { gameId: 'g1', createdAt: 0 },
    seq: 0,
    startedAt: 0,
    actionLog: [],
  };
}

describe('新 ENGINE-DESIGN createEngine — 出杀全流程', () => {
  let state: GameState;

  beforeEach(() => {
    state = buildInitialState();
    const engine = createEngine();
    engine.resetForTest();
    state = engine.bootstrap(state);
  });

  it('出杀:无回应 → 目标扣 1 血', async () => {
    const engine = createEngine();
    const next = await engine.dispatch(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 'P1',
      params: { cardId: 'c1', targets: ['P2'] },
      baseSeq: 0,
    });
    const p2 = next.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
    expect(p2.alive).toBe(true);
    expect(next.zones.discardPile).toContain('c1');
  });

  it('出杀:limit 验证 — 同回合第二次出杀应被拒绝', async () => {
    const engine = createEngine();
    state = await engine.dispatch(state, {
      skillId: '杀', actionType: 'use', ownerId: 'P1',
      params: { cardId: 'c1', targets: ['P2'] }, baseSeq: 0,
    });
    const c2: Card = { id: 'c2', name: '杀', suit: '♠', rank: 2, type: '基本牌' };
    state = {
      ...state,
      players: state.players.map(p => p.name === 'P1' ? { ...p, hand: ['c2'] } : p),
      cardMap: { ...state.cardMap, c2 },
    };
    const next = await engine.dispatch(state, {
      skillId: '杀', actionType: 'use', ownerId: 'P1',
      params: { cardId: 'c2', targets: ['P2'] }, baseSeq: 0,
    });
    const p2 = next.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
  });

  it('未注册的 action:静默丢弃', async () => {
    const engine = createEngine();
    const next = await engine.dispatch(state, {
      skillId: '不存在的 skill', actionType: 'use', ownerId: 'P1',
      params: { cardId: 'c1', targets: ['P2'] }, baseSeq: 0,
    });
    expect(next).toBe(state);
  });
});
