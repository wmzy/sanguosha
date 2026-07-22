// tests/skill-tests/界潜心.test.ts
// 界潜心(界徐庶·觉醒技)测试:
//   觉醒技，当你造成伤害后，若你已受伤，你减少1点体力上限并获得"荐言"。
//
// 验证:
//   1. happy path:P0 受伤 + 造成伤害 → 体力上限 -1 + 获得界荐言
//   2. 未受伤 → 不触发(P0 满血造成伤害)
//   3. 不是 P0 造成伤害 → 不触发(P1 造成伤害)
//   4. 已觉醒 → 不再触发(整局一次)
//   5. 伤害为 0 → 不触发
//   6. 回合外触发:P1 回合内 P0 造成伤害(P0 用诛害杀)也能触发潜心
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
// 临时注册界潜心/界荐言(主 agent 会统一注册到 index.ts)
import { skillLoaders } from '../../src/engine/skills';
import * as 界潜心Module from '../../src/engine/skills/界潜心';
import * as 界荐言Module from '../../src/engine/skills/界荐言';
import type { SkillModule } from '../../src/engine/skill';
skillLoaders['界潜心'] = async () => 界潜心Module as unknown as SkillModule;
skillLoaders['界荐言'] = async () => 界荐言Module as unknown as SkillModule;

import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { GameState, PlayerState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
  alive?: boolean;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界徐庶',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界潜心'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 直接造成一次伤害(模拟 P0 造成伤害) */
async function dealDamage(
  harness: SkillTestHarness,
  source: number,
  target: number,
  amount = 1,
): Promise<void> {
  await applyAtom(harness.state, { type: '造成伤害', target, amount, source });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界潜心', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path ─────────────────────────────────────
  it('happy path:P0 已受伤 + 造成伤害 → 体力上限 -1 + 获得界荐言', async () => {
    const state: GameState = createGameState({
      players: [
        // P0 满血 4/4 但已受伤:3/4(已受伤状态)
        makePlayer({
          index: 0,
          name: 'P0',
          health: 3,
          maxHealth: 4,
          skills: ['界潜心'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await dealDamage(harness, 0, 1, 1);

    // 觉醒:体力上限 -1(4→3),获得界荐言
    expect(harness.state.players[0].maxHealth).toBe(3);
    expect(harness.state.players[0].skills).toContain('界荐言');
    expect(harness.state.players[0].vars['界潜心/awakened']).toBe(true);
  });

  // ─── 2. 未受伤 → 不触发 ────────────────────────────────
  it('P0 满血造成伤害 → 不触发(未受伤)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 4,
          maxHealth: 4,
          skills: ['界潜心'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await dealDamage(harness, 0, 1, 1);

    expect(harness.state.players[0].maxHealth).toBe(4); // 未减
    expect(harness.state.players[0].skills).not.toContain('界荐言');
    expect(harness.state.players[0].vars['界潜心/awakened']).toBeUndefined();
  });

  // ─── 3. 不是 P0 造成伤害 → 不触发 ─────────────────────
  it('P1 造成伤害 → 不触发潜心(P0 不是来源)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 3,
          maxHealth: 4,
          skills: ['界潜心'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P1 造成伤害给 P0
    await dealDamage(harness, 1, 0, 1);

    expect(harness.state.players[0].maxHealth).toBe(4); // 未减
    expect(harness.state.players[0].skills).not.toContain('界荐言');
  });

  // ─── 4. 已觉醒 → 不再触发 ─────────────────────────────
  it('已觉醒 → 不再触发(整局一次)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 3,
          maxHealth: 4,
          skills: ['界潜心'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 第一次造成伤害 → 觉醒
    await dealDamage(harness, 0, 1, 1);
    expect(harness.state.players[0].maxHealth).toBe(3);
    expect(harness.state.players[0].skills).toContain('界荐言');

    // 第二次造成伤害 → 不再触发
    await dealDamage(harness, 0, 1, 1);
    expect(harness.state.players[0].maxHealth).toBe(3); // 仍是 3(未再减)
    expect(harness.state.players[0].skills.filter((s) => s === '界荐言').length).toBe(1);
  });

  // ─── 5. 伤害为 0 → 不触发 ──────────────────────────────
  it('amount=0 伤害 → 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 3,
          maxHealth: 4,
          skills: ['界潜心'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // amount=0,理论上不应造成伤害事件,这里直接验证潜心未触发
    // 由于 造成伤害 atom validate 不允许 amount<0,但允许 0,测试 0 伤害
    await applyAtom(harness.state, { type: '造成伤害', target: 1, amount: 0, source: 0 });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].maxHealth).toBe(4); // 未触发
    expect(harness.state.players[0].skills).not.toContain('界荐言');
  });

  // ─── 6. 回合外触发 ───────────────────────────────────
  it('回合外触发:P1 回合内 P0 造成伤害 → 仍触发潜心', async () => {
    const state: GameState = createGameState({
      players: [
        // P0 已受伤
        makePlayer({
          index: 0,
          name: 'P0',
          health: 3,
          maxHealth: 4,
          skills: ['界潜心'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: {},
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P0 在 P1 回合造成伤害(如诛害场景)
    await dealDamage(harness, 0, 1, 1);

    expect(harness.state.players[0].maxHealth).toBe(3); // 触发
    expect(harness.state.players[0].skills).toContain('界荐言');
  });
});
