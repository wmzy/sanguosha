// 勤学(界吕蒙·吴·觉醒技)行为测试,OL hero/306 现行版:
//   "觉醒技,准备阶段或结束阶段,若你的手牌数比你的体力值多2或更多,
//    你减1点体力上限,回复1点体力或摸两张牌,然后获得'攻心'。"
//
// 覆盖:
//   1. 准备阶段·差≥2·选摸两张牌 → 摸2 + 减1上限 + 获攻心 + 觉醒标记
//   2. 准备阶段·选回复1点体力 → 回1 + 减1上限 + 获攻心
//   3. 结束阶段也能触发(第二个触发点)
//   4. 差<2 不触发
//   5. 觉醒后不再触发(整局一次)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { GameState, PlayerState } from '../../src/engine/types';

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
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

describe('勤学', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 准备阶段·差≥2·选摸两张牌 ─────────────────────────
  it('准备阶段·手牌-体力≥2·选摸两张牌 → 摸2 + 减1上限 + 获攻心 + 觉醒', async () => {
    await harness.setup(
      createGameState({
        players: [
          // 体力2,手牌4 → 差=2 满足;maxHealth=4
          mkPlayer({
            index: 0,
            name: '界吕蒙',
            character: '界吕蒙',
            hand: ['h1', 'h2', 'h3', 'h4'],
            skills: ['勤学'],
            health: 2,
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
    const LM = harness.player('界吕蒙');

    // 触发准备阶段(勤学 after-hook 询问二选一)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    LM.expectPending('请求回应');

    // 选摸两张牌(choice=true → draw)
    await LM.respond('勤学', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(6); // 4 + 2
    expect(harness.state.players[0].maxHealth).toBe(3); // 4 → 3
    expect(harness.state.players[0].health).toBe(2); // 体力不变
    expect(harness.state.players[0].skills).toContain('攻心'); // 永久获得攻心
    expect(harness.state.players[0].vars['勤学/awakened']).toBe(true);
  });

  // ─── 2. 准备阶段·选回复1点体力 ───────────────────────────
  it('准备阶段·选回复1点体力 → 回1 + 减1上限 + 获攻心', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界吕蒙',
            character: '界吕蒙',
            hand: ['h1', 'h2', 'h3', 'h4'],
            skills: ['勤学'],
            health: 2,
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
    const LM = harness.player('界吕蒙');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    LM.expectPending('请求回应');

    // 选回复1点体力(choice=false → heal)
    await LM.respond('勤学', { choice: false });
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3); // 2 → 3(减上限后 max=3,可回1)
    expect(harness.state.players[0].maxHealth).toBe(3); // 4 → 3
    expect(harness.state.players[0].hand.length).toBe(4); // 不摸牌
    expect(harness.state.players[0].skills).toContain('攻心');
    expect(harness.state.players[0].vars['勤学/awakened']).toBe(true);
  });

  // ─── 3. 结束阶段也能触发 ─────────────────────────────────
  it('结束阶段·差≥2 → 也可触发勤学', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界吕蒙',
            character: '界吕蒙',
            hand: ['h1', 'h2', 'h3', 'h4'],
            skills: ['勤学'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', skills: [] }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 1, phase: '回合结束', vars: {} },
      }),
    );
    const LM = harness.player('界吕蒙');

    // 触发结束阶段(第二个触发点)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    LM.expectPending('请求回应');
    await LM.respond('勤学', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].skills).toContain('攻心');
    expect(harness.state.players[0].vars['勤学/awakened']).toBe(true);
  });

  // ─── 4. 差<2 不触发 ─────────────────────────────────────
  it('手牌-体力<2 → 勤学不触发', async () => {
    await harness.setup(
      createGameState({
        players: [
          // 体力2,手牌3 → 差=1 <2
          mkPlayer({
            index: 0,
            name: '界吕蒙',
            character: '界吕蒙',
            hand: ['h1', 'h2', 'h3'],
            skills: ['勤学'],
            health: 2,
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

    expect(harness.state.pendingSlots.size).toBe(0); // 无询问
    expect(harness.state.players[0].vars['勤学/awakened']).toBeFalsy();
    expect(harness.state.players[0].maxHealth).toBe(4); // 上限不变
    expect(harness.state.players[0].skills).not.toContain('攻心');
  });

  // ─── 5. 觉醒后不再触发(整局一次)──────────────────────────
  it('觉醒后再次准备阶段不再触发', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界吕蒙',
            character: '界吕蒙',
            hand: ['h1', 'h2', 'h3', 'h4'],
            skills: ['勤学'],
            health: 2,
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
    const LM = harness.player('界吕蒙');

    // 第一次:触发觉醒
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();
    await LM.respond('勤学', { choice: true });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['勤学/awakened']).toBe(true);
    const maxAfterAwaken = harness.state.players[0].maxHealth; // 3

    // 第二次:已觉醒,不再触发
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    await harness.waitForStable();

    expect(harness.state.pendingSlots.size).toBe(0); // 无询问
    expect(harness.state.players[0].maxHealth).toBe(maxAfterAwaken); // 上限不再减
  });
});
