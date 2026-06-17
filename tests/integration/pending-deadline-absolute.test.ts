// tests/diagnose_deadline.test.ts
// 验证 buildView 发出的 deadline 是相对时间,前端 hook 误用为绝对时间
import { describe, it, expect, beforeEach } from 'vitest';
import { dispatch, registerSkillsFromState, resetForTest, buildView } from '../../src/engine/create-engine';
import { waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../src/engine/types';
import { createGameState } from "../../src/engine/types";

function buildState(): GameState {
  const slash: Card = { id: 'c1', name: '杀', suit: '♠', rank: 'A', type: '基本牌' };
  const dodge: Card = { id: 'c2', name: '闪', suit: '♥', rank: 'K', type: '基本牌' };
  return createGameState({
    players: [
      { name: 'P1', character: '关羽', health: 4, maxHealth: 4, hand: ['c1'], alive: true, skills: ['武圣', '杀'], index: 0, equipment: {}, vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
      { name: 'P2', character: '郭嘉', health: 4, maxHealth: 4, hand: ['c2'], alive: true, skills: ['遗计', '闪'], index: 1, equipment: {}, vars: {}, marks: [], pendingTricks: [], judgeZone: [] },
    ],
    cardMap: { c1: slash, c2: dodge },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('诊断:deadline 时间格式', () => {
  let state: GameState;

  beforeEach(async () => {
    resetForTest();
    state = buildState();
    state.startedAt = Date.now(); // 模拟 create() 真实开局
    await registerSkillsFromState(state);
  });

  it('修复后:buildView 发送的 deadline 是绝对时间戳', async () => {
    // 出发杀创建 pending
    void dispatch(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 0,
      params: { cardId: 'c1', targets: [1] },
      baseSeq: state.seq,
    });
    await waitForStable(state);

    const slot = state.pendingSlot!;
    const view = buildView(state, 0, true);
    console.log('slot.deadline (相对):', slot.deadline);
    console.log('view.pending.deadline (修复后):', view.pending?.deadline);
    console.log('Date.now():', Date.now());

    // 修复后: view.pending.deadline = state.startedAt + slot.deadline (绝对时间戳)
    expect(view.pending?.deadline).toBe(state.startedAt + slot.deadline);
    // 跟 Date.now() 差不多 (+15s 内)
    expect(view.pending!.deadline).toBeGreaterThan(Date.now());
    expect(view.pending!.deadline - Date.now()).toBeGreaterThan(14000);
    expect(view.pending!.deadline - Date.now()).toBeLessThan(16000);

    // 前端 remainingSeconds 应该是 15
    const remainingSeconds = Math.max(0, Math.ceil((view.pending!.deadline - Date.now()) / 1000));
    console.log('修复后 remainingSeconds:', remainingSeconds);
    expect(remainingSeconds).toBe(15);
  });
});
