// 界义从(界公孙瓒·锁定技)测试:
//   锁定技,你计算与其他角色的距离-1;若你的体力值不大于2,其他角色计算与你的距离+1。
//
// 验证:
//   1. 单元:onInit 后 vars['距离/进攻修正'] = 1(常驻)
//   2. 单元:体力 > 2 时,vars['距离/防御修正'] 未设
//   3. 单元:体力 ≤ 2 时,vars['距离/防御修正'] = 1
//   4. 触发(实际 dispatch):P0(义从,徒手)对距离 2 的 P2 出杀 → 命中(-1 距离生效)
//   5. 触发:受伤害掉到 2 血 → after hook 同步防御修正 = 1
//   6. 触发:回复到 3 血 → after hook 同步防御修正被清除
//   7. 触发:失去体力掉到 2 血 → after hook 同步防御修正 = 1
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { effectiveDistance } from '../../src/engine/distance';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '界公孙瓒',
    health: opts.health ?? 4,
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

/** 4 人存活局:P0/P1/P2/P3,环形座位 */
function build4PlayerState(opts: {
  p0Skills?: string[];
  p0Hand?: string[];
  p0Health?: number;
  cardMap?: Record<string, Card>;
}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        skills: opts.p0Skills ?? [],
        hand: opts.p0Hand ?? [],
        health: opts.p0Health ?? 4,
      }),
      makePlayer({ index: 1, name: 'P2', skills: [] }),
      makePlayer({ index: 2, name: 'P3', skills: [] }),
      makePlayer({ index: 3, name: 'P4', skills: [] }),
    ],
    cardMap: opts.cardMap ?? {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界义从', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 单元:onInit 后进攻修正 = 1(常驻)
  // ─────────────────────────────────────────────────────────────
  it('单元:onInit 后 vars[距离/进攻修正] = 1', async () => {
    await harness.setup(build4PlayerState({ p0Skills: ['界义从'] }));
    expect(harness.state.players[0].vars['距离/进攻修正']).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 单元:体力 > 2 时,防御修正未设
  // ─────────────────────────────────────────────────────────────
  it('单元:体力=4 时,vars[距离/防御修正] 未设', async () => {
    await harness.setup(build4PlayerState({ p0Skills: ['界义从'], p0Health: 4 }));
    expect(harness.state.players[0].vars['距离/防御修正']).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 单元:体力 ≤ 2 时,防御修正 = 1
  // ─────────────────────────────────────────────────────────────
  it('单元:初始体力=2 时,onInit 后 vars[距离/防御修正] = 1', async () => {
    await harness.setup(build4PlayerState({ p0Skills: ['界义从'], p0Health: 2 }));
    expect(harness.state.players[0].vars['距离/防御修正']).toBe(1);
  });

  it('单元:初始体力=1 时,onInit 后 vars[距离/防御修正] = 1', async () => {
    await harness.setup(build4PlayerState({ p0Skills: ['界义从'], p0Health: 1 }));
    expect(harness.state.players[0].vars['距离/防御修正']).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────
  // 4. 触发:P0(徒手,范围 1)对距离 2 的 P2 出杀 → 命中(进攻-1 生效)
  // ─────────────────────────────────────────────────────────────
  it('触发:P0(义从)徒手对距离 2 的 P2 出杀 → 命中(进攻-1 缩距到 1)', async () => {
    const slash = makeCard('s1', '杀', '♠', 'A');
    const state = build4PlayerState({
      p0Skills: ['界义从', '杀'],
      p0Hand: ['s1'],
    });
    state.cardMap = { s1: slash };
    await harness.setup(state);

    // 4 人局 P0→P2 座位距离 2,义从 -1 → 实际 1
    expect(effectiveDistance(harness.state, 0, 2)).toBe(1);

    const P1 = harness.player('P1');
    const P3 = harness.player('P3');
    await P1.useCardAndTarget('杀', 's1', [2]);
    await P3.pass();
    expect(harness.state.players[2].health).toBe(3); // 命中扣 1 血
  });

  // ─────────────────────────────────────────────────────────────
  // 5. 触发:受伤害掉到 2 血 → 防御修正同步 = 1
  // ─────────────────────────────────────────────────────────────
  it('触发:受伤害从 3 血掉到 2 血 → 防御修正同步 = 1', async () => {
    const slash = makeCard('s1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界义从'], health: 3 }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: ['杀'],
          hand: ['s1'],
        }),
      ],
      cardMap: { s1: slash },
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    // 初始 3 血 → 防御未设
    expect(harness.state.players[0].vars['距离/防御修正']).toBeUndefined();

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    await P1.useCardAndTarget('杀', 's1', [0]);
    await P0.pass(); // 不出闪

    // 受 1 伤:3 → 2,防御修正同步 = 1
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].vars['距离/防御修正']).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────
  // 6. 触发:回复到 3 血 → 防御修正同步被清除
  // ─────────────────────────────────────────────────────────────
  it('触发:回复体力从 2 到 3 → 防御修正被清除', async () => {
    const peach = makeCard('p1', '桃', '♥', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['界义从', '桃'],
          hand: ['p1'],
          health: 2,
        }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: { p1: peach },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    // 初始 2 血 → 防御 = 1
    expect(harness.state.players[0].vars['距离/防御修正']).toBe(1);

    const P0 = harness.player('P0');
    // P0 对自己出桃回血
    await P0.useCardAndTarget('桃', 'p1', [0]);

    // 回复到 3 血 → 防御修正被清除
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].vars['距离/防御修正']).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────
  // 7. 触发:失去体力掉到 2 血 → 防御修正同步 = 1
  // ─────────────────────────────────────────────────────────────
  it('触发:失去体力从 3 到 2 → 防御修正同步 = 1', async () => {
    // 用 界强袭(界典韦主动技)对自己造成伤害来间接验证失去体力路径:
    // 这里直接用 造成伤害 atom 模拟"自伤掉血"。但 onInit hooks 需要 state-bound
    // 注册,且直接 dispatch 自伤会触发 feedback 等。简单方式:用玩家手动 dispatch
    // 一个 失去体力 atom 不通过 hook。改为通过注册的 hook 间接验证。
    //
    // 改用更简单方法:P0(3 血)装上白银狮子后受伤害,白银狮子减伤为 0 不算;
    // 直接用界强袭自伤:cost=damage,target=P1,会扣 P0 1 血(3→2)。但 P0 需装界强袭。
    //
    // 最简:借助另一个角色(狂骨无此功能,改用典韦强袭):P0=界典韦+界义从(同持两技)。
    // 但角色技能限制只允许同武将。改用直接 applyAtom 模拟失去体力。
    //
    // 更简单:dispatch 一个 失去体力 atom 直接走 hook 链。
    const { registerSkillsFromState, applyAtom } = await import(
      '../../src/engine/create-engine'
    );
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界义从'], health: 3 }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await registerSkillsFromState(state);
    expect(state.players[0].vars['距离/防御修正']).toBeUndefined();

    // 直接 applyAtom 一个失去体力(走 hook 链,触发义从 after-hook)
    await applyAtom(state, { type: '失去体力', target: 0, amount: 1 });

    expect(state.players[0].health).toBe(2);
    expect(state.players[0].vars['距离/防御修正']).toBe(1);
  });
});
