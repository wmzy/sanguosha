// 验证 并行回应 atom 的引擎机制:多 target 独立 slot 创建 + Map 行为
// respond 验证通过 fireTimeout 模拟(绕过 respond action 注册)
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtom, fireTimeout, resetForTest } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function build(): GameState {
  const cards: Card[] = [
    { id: 'a1', name: '杀', suit: '♠', rank: '7', type: '基本牌' },
    { id: 'b1', name: '杀', suit: '♣', rank: '3', type: '基本牌' },
  ];
  const cardMap: Record<string, Card> = {};
  for (const c of cards) cardMap[c.id] = c;
  return createGameState({
    players: [
      { index: 0, name: 'A', character: 'X', health: 4, maxHealth: 4, alive: true, hand: ['a1'], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { index: 1, name: 'B', character: 'Y', health: 4, maxHealth: 4, alive: true, hand: ['b1'], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}
const tick = () => new Promise(r => setTimeout(r, 100));

describe('并行回应 atom 引擎机制', () => {
  let state: GameState;
  beforeEach(() => {
    resetForTest();
    state = build();
  });

  it('为多 target 创建独立 slot,Map 含两个不同 key', async () => {
    const p = applyAtom(state, {
      type: '并行回应',
      requestType: '测试',
      targets: [0, 1],
      prompt: { type: 'useCard', title: '选牌', cardFilter: { min: 1, max: 1 } },
      timeout: 30,
    });
    await tick();

    expect(state.pendingSlots.size).toBe(2);
    expect(state.pendingSlots.has(0)).toBe(true);
    expect(state.pendingSlots.has(1)).toBe(true);

    // fireTimeout 触发所有 slot 的超时(模拟全部 respond)
    await fireTimeout(state);
    await tick();
    await p;

    expect(state.pendingSlots.size).toBe(0);
  });

  it('单 target 请求回应 Map size=1(向后兼容)', async () => {
    const p = applyAtom(state, {
      type: '请求回应',
      requestType: '测试单',
      target: 0,
      prompt: { type: 'confirm', title: '确认' },
      timeout: 30,
    });
    await tick();

    expect(state.pendingSlots.size).toBe(1);
    expect(state.pendingSlots.has(0)).toBe(true);

    await fireTimeout(state);
    await tick();
    await p;

    expect(state.pendingSlots.size).toBe(0);
  });

  it('fireTimeout 逐个清除 slot(模拟玩家依次 respond)', async () => {
    const p = applyAtom(state, {
      type: '并行回应',
      requestType: '逐个',
      targets: [0, 1],
      prompt: { type: 'confirm', title: '确认' },
      timeout: 30,
    });
    await tick();
    expect(state.pendingSlots.size).toBe(2);

    // 触发超时(fireTimeout 会触发所有 slot)
    await fireTimeout(state);
    await tick();
    await p;
    expect(state.pendingSlots.size).toBe(0);
  });
});
