// tests/integration/new-engine-fire-timeout.test.ts
// 引擎 fireTimeout() 单元测试(归 core 项目)
import { describe, it, expect, beforeEach } from 'vitest';
import { createEngine, type EngineInstance } from '../../src/engine/create-engine';
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

describe('engine.fireTimeout', () => {
  let engine: EngineInstance;
  beforeEach(() => {
    engine = createEngine();
    engine.resetForTest();
    engine.bootstrap(buildInitialState());
  });

  it('无 pending 时调用:返回当前 state,不抛错', async () => {
    const before = engine.getState();
    const result = await engine.fireTimeout();
    expect(result.state).toBe(before);
    expect(result.gameOver).toBeFalsy();
  });

  it('有 pending(询问闪)时调用:触发 onTimeout → pending 清空 → P2 扣 1 血', async () => {
    await engine.dispatch({
      skillId: '杀', actionType: 'use', ownerId: 'P1',
      params: { cardId: 'c1', targets: ['P2'] }, baseSeq: 0,
    });
    expect(engine.getState().pendingSlot).toBeDefined();

    await engine.fireTimeout();
    expect(engine.getState().pendingSlot).toBeUndefined();
    const p2 = engine.getState().players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(3);
  });
});
