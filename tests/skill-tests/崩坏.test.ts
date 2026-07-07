// 崩坏(董卓·锁定技)技能测试:
//   回合结束阶段,若你的体力不是全场最少的(或同时为最少),你须减1点体力或1点体力上限。
//
// 触发条件:体力严格大于全场最小值才触发;== 最小(含并列)不触发。
//
// 验证:
//   1. 正面:体力 > 最小 → 选择减体力上限(maxHealth-1)
//   2. 正面:体力 > 最小 → 选择减体力(health-1)
//   3. 负面:体力 == 全场最小 → 不触发(无询问)
//   4. 边界:体力上限最低降至 1(不越界)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { GameState, PlayerState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  health: number;
  maxHealth: number;
  skills?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '董卓',
    health: opts.health,
    maxHealth: opts.maxHealth,
    alive: true,
    hand: [],
    equipment: {},
    skills: opts.skills ?? ['崩坏'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function buildState(opts: {
  p0Health: number;
  p0MaxHealth?: number;
  p1Health: number;
  p1MaxHealth?: number;
}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P0',
        health: opts.p0Health,
        maxHealth: opts.p0MaxHealth ?? 8,
      }),
      makePlayer({
        index: 1,
        name: 'P1',
        health: opts.p1Health,
        maxHealth: opts.p1MaxHealth ?? 4,
        skills: [],
      }),
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '回合结束',
    turn: { round: 1, phase: '回合结束', vars: {} },
  });
}

/** 直接触发结束阶段(阶段开始 phase='回合结束'),等稳定 */
async function triggerEndPhase(harness: SkillTestHarness): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('崩坏', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:选择减体力上限 ───────────────────────────────

  it('体力5 > 最小3 → 选择减体力上限 → maxHealth 8→7,health 不变', async () => {
    const state = buildState({ p0Health: 5, p1Health: 3 });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness);

    // 崩坏询问
    P0.expectPending('请求回应');
    await P0.respond('崩坏', { choice: true }); // 减体力上限

    expect(harness.state.players[0].maxHealth).toBe(7);
    expect(harness.state.players[0].health).toBe(5);
  });

  // ─── 正面:选择减体力 ───────────────────────────────────

  it('体力5 > 最小3 → 选择减体力 → health 5→4,maxHealth 不变', async () => {
    const state = buildState({ p0Health: 5, p1Health: 3 });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness);

    P0.expectPending('请求回应');
    await P0.respond('崩坏', { choice: false }); // 减体力

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[0].maxHealth).toBe(8);
  });

  // ─── 负面:体力 == 全场最小 → 不触发 ────────────────────

  it('体力3 == 最小3 → 崩坏不触发(无询问)', async () => {
    const state = buildState({ p0Health: 3, p1Health: 3 });
    await harness.setup(state);

    await triggerEndPhase(harness);

    // 无 pending,health/maxHealth 均不变
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].maxHealth).toBe(8);
  });

  it('体力3 < 最小5(并列最小即最小)→ 崩坏不触发', async () => {
    // 董卓 3,对方 5 → 最小是 3,董卓==最小 → 不触发
    const state = buildState({ p0Health: 3, p1Health: 5 });
    await harness.setup(state);

    await triggerEndPhase(harness);

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].maxHealth).toBe(8);
  });

  // ─── 边界:体力上限最低降至 1 ────────────────────────────

  it('maxHealth=2 选择减体力上限 → 降至 1(不越界)', async () => {
    const state = buildState({ p0Health: 2, p0MaxHealth: 2, p1Health: 1 });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await triggerEndPhase(harness);

    P0.expectPending('请求回应');
    await P0.respond('崩坏', { choice: true }); // 减体力上限

    expect(harness.state.players[0].maxHealth).toBe(1);
  });
});
