// 若愚(刘禅·觉醒主公技)行为测试:
//   1. 主公(ownerId===0)体力全场最少 → 触发:增1上限 + 回复1体力 + 永久获得激将
//   2. 体力非最少(比别人多)→ 不触发
//   3. 非主公(ownerId!==0)→ 不触发
//   4. 觉醒后再次回合开始不再触发(整局一次)
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
    health: opts.health ?? opts.maxHealth ?? 3,
    maxHealth: opts.maxHealth ?? 3,
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

describe('若愚', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('主公体力全场最少 → 增1上限 + 回复1体力 + 获得激将', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '刘禅',
            character: '刘禅',
            skills: ['若愚'],
            health: 1,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 触发回合开始(若愚是被动觉醒,无询问,自动结算)
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(harness.state.players[0].maxHealth).toBe(4); // 3→4 增1上限
    expect(harness.state.players[0].health).toBe(2); // 1→2 回复1点
    expect(harness.state.players[0].skills).toContain('激将'); // 永久获得激将
    expect(harness.state.players[0].vars['若愚/awakened']).toBe(true);
  });

  it('体力非最少时不触发若愚', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '刘禅',
            character: '刘禅',
            skills: ['若愚'],
            health: 3,
            maxHealth: 3, // 满血,全场最多
          }),
          mkPlayer({ index: 1, name: 'P1', health: 1, maxHealth: 4 }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(harness.state.players[0].maxHealth).toBe(3); // 上限不变
    expect(harness.state.players[0].health).toBe(3); // 体力不变
    expect(harness.state.players[0].skills).not.toContain('激将');
    expect(harness.state.players[0].vars['若愚/awakened']).toBeFalsy();
  });

  it('体力全场最少之一(并列)也触发', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '刘禅',
            character: '刘禅',
            skills: ['若愚'],
            health: 2,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1', health: 2, maxHealth: 4 }), // 并列最少
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    // 并列最少(或之一)→ 触发
    expect(harness.state.players[0].maxHealth).toBe(4);
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].skills).toContain('激将');
    expect(harness.state.players[0].vars['若愚/awakened']).toBe(true);
  });

  it('非主公(ownerId!==0)不触发', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '主公', health: 4, maxHealth: 4 }),
          mkPlayer({
            index: 1,
            name: '刘禅',
            character: '刘禅',
            skills: ['若愚'],
            health: 1, // 全场最少
            maxHealth: 3,
          }),
        ],
        cardMap: {},
        currentPlayerIndex: 1,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 刘禅在座次1(非主公位),即便体力最少也不触发
    await applyAtom(harness.state, { type: '回合开始', player: 1 });
    await harness.waitForStable();

    expect(harness.state.players[1].maxHealth).toBe(3); // 上限不变
    expect(harness.state.players[1].health).toBe(1); // 体力不变
    expect(harness.state.players[1].skills).not.toContain('激将');
    expect(harness.state.players[1].vars['若愚/awakened']).toBeFalsy();
  });

  it('觉醒后再次回合开始不再触发', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '刘禅',
            character: '刘禅',
            skills: ['若愚'],
            health: 1,
            maxHealth: 3,
          }),
          mkPlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4 }),
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
    expect(harness.state.players[0].vars['若愚/awakened']).toBe(true);
    expect(harness.state.players[0].maxHealth).toBe(4);

    // 把刘禅体力调回最少,模拟下一回合
    harness.state.players[0].health = 1;

    // 第二次回合开始:已觉醒,不再触发
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(harness.state.players[0].maxHealth).toBe(4); // 上限不再增
    expect(harness.state.players[0].health).toBe(1); // 不再回复
  });
});
