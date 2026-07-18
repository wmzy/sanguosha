// 魂姿(孙策·觉醒技)行为测试:
//   1. 准备阶段体力为1 → 觉醒:减1上限(maxHealth 4→3) + 永久获得英姿、英魂
//   2. 回合开始时不触发(触发时机为准备阶段,非回合开始)
//   3. 体力>1(如2)→ 不触发
//   4. 已觉醒再次准备阶段 → 不再触发(整局一次)
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

  it('准备阶段体力为1 → 减1上限 + 获得英姿、英魂', async () => {
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

    // 触发准备阶段(觉醒技,被动,无询问,自动结算)
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    expect(harness.state.players[0].maxHealth).toBe(3); // 4→3 减1上限
    expect(harness.state.players[0].health).toBe(1); // 体力保持1
    expect(harness.state.players[0].skills).toContain('英姿');
    expect(harness.state.players[0].skills).toContain('英魂');
    expect(harness.state.players[0].vars['魂姿/awakened']).toBe(true);
  });

  it('体力>1(为2)时准备阶段不触发', async () => {
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

    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    expect(harness.state.players[0].maxHealth).toBe(4); // 上限不变
    expect(harness.state.players[0].health).toBe(2); // 体力不变
    expect(harness.state.players[0].skills).not.toContain('英姿');
    expect(harness.state.players[0].skills).not.toContain('英魂');
    expect(harness.state.players[0].vars['魂姿/awakened']).toBeFalsy();
  });

  it('回合开始时不触发(触发时机为准备阶段)', async () => {
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

    // 回合开始:魂姿不在此触发(官方触发时机为准备阶段)
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(harness.state.players[0].vars['魂姿/awakened']).toBeFalsy(); // 未觉醒
    expect(harness.state.players[0].maxHealth).toBe(4); // 上限不变
    expect(harness.state.players[0].skills).not.toContain('英姿');
    expect(harness.state.players[0].skills).not.toContain('英魂');
  });

  it('已觉醒再次准备阶段不再触发', async () => {
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
    const SC = harness.player('孙策');

    // 第一次准备阶段:触发觉醒
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['魂姿/awakened']).toBe(true);
    expect(harness.state.players[0].maxHealth).toBe(3);
    expect(harness.state.players[0].skills).toContain('英姿');
    const maxAfterAwaken = harness.state.players[0].maxHealth; // 3
    const skillsAfterAwaken = harness.state.players[0].skills.length;

    // 第二次准备阶段:已觉醒,魂姿不再触发。
    // 觉醒后获得的"英魂"是准备阶段 before-hook(已受伤 HP1<上限3 → 询问发动),
    // 其 before-hook 会 await 询问从而阻塞 applyAtom,故用 fire-and-forget 触发,
    // 等 confirm pending 出现后回应"不发动"以排除其干扰。
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    if (harness.state.pendingSlots.size > 0) {
      await SC.respond('英魂', { choice: false }); // 不发动英魂
      await harness.waitForStable();
    }

    // 魂姿不再触发:上限不再减、技能不再增
    expect(harness.state.players[0].maxHealth).toBe(maxAfterAwaken); // 仍为3
    const yingziCount = harness.state.players[0].skills.filter((s) => s === '英姿').length;
    expect(yingziCount).toBe(1);
    expect(harness.state.players[0].skills.length).toBe(skillsAfterAwaken); // 不再增加技能
  });
});
