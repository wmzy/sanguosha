// tests/integration/new-engine-hujia.test.ts
// 集成测试 2: 新 ENGINE-DESIGN createEngine + 武将技能 护甲(锁定被动)
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
      { index: 0, name: 'P1', character: '主公', health: 4, maxHealth: 4, alive: true, hand: ['c1'], equipment: {}, skills: ['杀'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'P2', character: '曹操', health: 4, maxHealth: 4, alive: true, hand: [], equipment: {}, skills: ['护甲'], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: { c1: slash },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('新 ENGINE-DESIGN createEngine — 护甲(曹操·锁定被动)', () => {
  let engine: EngineInstance;

  beforeEach(() => {
    engine = createEngine();
    engine.resetForTest();
    engine.bootstrap(buildInitialState());
  });

  it('受到黑色【杀】 → 扣 0 血(护甲吸收)', async () => {
    await engine.dispatch({
      skillId: '杀', actionType: 'use', ownerId: 'P1',
      params: { cardId: 'c1', targets: ['P2'] }, baseSeq: 0,
    });
    const next = engine.getState();
    const p2 = next.players.find(p => p.name === 'P2')!;
    expect(p2.health).toBe(4);
    expect(p2.alive).toBe(true);
  });
});
