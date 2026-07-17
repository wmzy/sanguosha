// 界孙策 界魂姿 行为测试(界限突破版,OL hero/452):
//   核心差异:魂姿触发时机从「回合开始」改为「准备阶段」。
//   1. 准备阶段体力为1 → 减1上限 + 获得英姿/英魂 + 觉醒标记,体力保持1(强制,无询问)
//   2. 回合开始时不触发(原版会触发,界版不触发 — 关键差异验证)
//   3. 体力>1时准备阶段不触发
//   4. 觉醒后再次准备阶段不再触发(整局一次;觉醒后获得的英魂会询问,需回应不发动)
//   5. 觉醒当回合结束阶段 → 摸2张 或 回复1体力(二选一)
//   6. 非觉醒回合的结束阶段不触发收益(标记只在觉醒当回合置)
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
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? opts.name,
    health: opts.health ?? opts.maxHealth ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界孙策·界魂姿', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('准备阶段触发:体力为1 → 减1上限 + 获得英姿英魂 + 觉醒标记(强制,无询问)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            character: '界孙策',
            hand: ['h1'],
            skills: ['界魂姿'],
            health: 1,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 触发准备阶段:界魂姿强制觉醒(无询问)
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0); // 强制觉醒,无询问
    expect(harness.state.players[0].maxHealth).toBe(3); // 减1上限(4→3)
    expect(harness.state.players[0].health).toBe(1); // 体力保持1
    expect(harness.state.players[0].skills).toContain('英姿'); // 永久获得英姿(普通版)
    expect(harness.state.players[0].skills).toContain('英魂'); // 永久获得英魂
    expect(harness.state.players[0].skills).not.toContain('界英姿'); // 不是界英姿
    expect(harness.state.players[0].vars['魂姿/awakened']).toBe(true); // 觉醒标记
  });

  it('回合开始时不触发(界版差异:仅准备阶段触发)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            character: '界孙策',
            hand: ['h1'],
            skills: ['界魂姿'],
            health: 1,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 回合开始:界版魂姿不在此触发(原版会)
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0); // 无询问
    expect(harness.state.players[0].vars['魂姿/awakened']).toBeFalsy(); // 未觉醒
    expect(harness.state.players[0].maxHealth).toBe(4); // 上限不变
    expect(harness.state.players[0].skills).not.toContain('英姿');
    expect(harness.state.players[0].skills).not.toContain('英魂');
  });

  it('体力>1时准备阶段不触发界魂姿', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            character: '界孙策',
            hand: ['h1'],
            skills: ['界魂姿'],
            health: 2, // 体力>1,不满足条件
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].vars['魂姿/awakened']).toBeFalsy();
    expect(harness.state.players[0].maxHealth).toBe(4); // 上限不变
    expect(harness.state.players[0].skills).not.toContain('英姿');
  });

  it('觉醒后再次准备阶段不再触发(整局一次)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            character: '界孙策',
            hand: ['h1'],
            skills: ['界魂姿'],
            health: 1,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');

    // 第一次准备阶段:触发觉醒
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['魂姿/awakened']).toBe(true);
    const maxAfterAwaken = harness.state.players[0].maxHealth; // 3
    const skillsAfterAwaken = harness.state.players[0].skills.length;

    // 第二次准备阶段:已觉醒,界魂姿不再触发。
    // 觉醒后获得的"英魂"是准备阶段 before-hook(已受伤 HP1<上限3 → 询问发动),
    // 其 before-hook 会 await 询问从而阻塞 applyAtom,故用 fire-and-forget 触发,
    // 等 confirm pending 出现后回应"不发动"以排除其干扰。
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    if (harness.state.pendingSlots.size > 0) {
      await SC.respond('英魂', { choice: false }); // 不发动英魂
      await harness.waitForStable();
    }

    // 界魂姿不再触发:上限不再减、技能不再增
    expect(harness.state.players[0].maxHealth).toBe(maxAfterAwaken); // 仍为3
    expect(harness.state.players[0].skills.length).toBe(skillsAfterAwaken); // 不再增加技能
  });

  // ─── 结束阶段收益(界新增)───

  it('觉醒当回合结束阶段 → 选摸2张 → 摸2张', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            character: '界孙策',
            hand: ['h1'],
            skills: ['界魂姿'],
            health: 1,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');

    // 准备阶段觉醒
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['魂姿/awakened']).toBe(true);
    expect(harness.state.players[0].vars['界魂姿/endBonus']).toBe(true); // 收益标记已置
    const handBeforeEnd = harness.state.players[0].hand.length;

    // 结束阶段:触发收益二选一(after-hook 创建询问 pending,故 fire-and-forget)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    SC.expectPending('请求回应');
    await SC.respond('界魂姿', { choice: true }); // 摸两张牌
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(handBeforeEnd + 2); // 摸2张
    // 标记已消费
    expect(harness.state.players[0].vars['界魂姿/endBonus']).toBeFalsy();
  });

  it('觉醒当回合结束阶段 → 选回复1体力 → 体力+1', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            character: '界孙策',
            hand: ['h1'],
            skills: ['界魂姿'],
            health: 1,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const SC = harness.player('界孙策');

    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    // 觉醒后体力为1(保持),上限3
    expect(harness.state.players[0].health).toBe(1);

    // 结束阶段:选回复1体力
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    SC.expectPending('请求回应');
    await SC.respond('界魂姿', { choice: false }); // 回复1点体力
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(2); // 1→2
    expect(harness.state.players[0].vars['界魂姿/endBonus']).toBeFalsy();
  });

  it('未觉醒时结束阶段不触发收益(无标记无询问)', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙策',
            character: '界孙策',
            hand: ['h1'],
            skills: ['界魂姿'],
            health: 3, // 体力>1,不会觉醒
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 准备阶段:体力>1不觉醒
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['界魂姿/endBonus']).toBeFalsy();

    // 结束阶段:无收益触发(无 pending)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
