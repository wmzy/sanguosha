// 魂姿(孙策·觉醒技)行为测试:
//   1. 体力为1 → 觉醒:减1上限(maxHealth 4→3) + 永久获得英姿、英魂
//   2. 体力>1(如2)→ 不触发
//   3. 已觉醒再次回合开始 → 不再触发(整局一次)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';

function mkPlayer(opts: {
  index: number;
  name: string;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? opts.maxHealth ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('魂姿', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('体力为1 → 减1上限 + 获得英姿、英魂', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '孙策', skills: ['魂姿'], health: 1, maxHealth: 4 }),
          mkPlayer({ index: 1, name: 'P2', health: 4, maxHealth: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 触发回合开始(觉醒技,被动,无询问,自动结算)
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(harness.state.players[0].maxHealth).toBe(3); // 4→3 减1上限
    expect(harness.state.players[0].health).toBe(1); // 体力保持1
    expect(harness.state.players[0].skills).toContain('英姿');
    expect(harness.state.players[0].skills).toContain('英魂');
    expect(harness.state.players[0].vars['魂姿/awakened']).toBe(true);
  });

  it('体力>1(为2)时不触发', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '孙策', skills: ['魂姿'], health: 2, maxHealth: 4 }),
          mkPlayer({ index: 1, name: 'P2', health: 4, maxHealth: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(harness.state.players[0].maxHealth).toBe(4); // 上限不变
    expect(harness.state.players[0].health).toBe(2); // 体力不变
    expect(harness.state.players[0].skills).not.toContain('英姿');
    expect(harness.state.players[0].skills).not.toContain('英魂');
    expect(harness.state.players[0].vars['魂姿/awakened']).toBeFalsy();
  });

  it('已觉醒再次回合开始不再触发', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '孙策', skills: ['魂姿'], health: 1, maxHealth: 4 }),
          mkPlayer({ index: 1, name: 'P2', health: 4, maxHealth: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 第一次触发觉醒
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['魂姿/awakened']).toBe(true);
    expect(harness.state.players[0].maxHealth).toBe(3);
    expect(harness.state.players[0].skills).toContain('英姿');

    // 模拟下一回合:体力仍为1,再次回合开始
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    // 上限不再减少,技能不再重复添加
    expect(harness.state.players[0].maxHealth).toBe(3);
    const yingziCount = harness.state.players[0].skills.filter((s) => s === '英姿').length;
    expect(yingziCount).toBe(1);
  });
});
