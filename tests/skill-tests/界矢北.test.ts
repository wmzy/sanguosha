// 界矢北(界沮授·群·锁定技)测试:
// 核心规则(OL 界限突破官方逐字):
//   锁定技,游戏开始时,你获得3点护甲。当你每回合首次受到伤害后,你回复1点体力,
//   然后当你本回合再受到伤害后,你失去1点体力。
//
// 用例:
//   1. 游戏开始初始化:首次 回合开始 → 获得 3 点护甲
//   2. 游戏开始初始化仅触发一次
//   3. 护甲减伤:1 伤害 → 0 实伤,护甲 -1,不触发回血/失血
//   4. 护甲减伤:3 伤害(护甲满) → 0 实伤,护甲归零
//   5. 护甲减伤:5 伤害(护甲 3) → 2 实伤,护甲归零,触发首伤回 1 血
//   6. 首次受伤(无护甲):伤害后回 1 血(净效果 0)
//   7. 再伤(同回合):失 1 血(非伤害,不触发奸雄等)
//   8. 跨回合重置:新回合首次受伤回血,而非失血
//   9. 护甲全吸收(0 实伤)不计入"受到伤害"次数
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { runDamageFlow } from '../../src/engine/damage-flow';
import type { GameState, PlayerState } from '../../src/engine/types';

const ARMOR_PREFIX = '界矢北/护甲:';
const DAMAGE_COUNT_KEY = '界矢北/damageCount/usedThisTurn';

function makePlayer(opts: {
  index: number;
  name: string;
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
  vars?: Record<string, import("../../src/engine/types").Json>;
  marks?: import("../../src/engine/types").Mark[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界沮授',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: [],
    equipment: {},
    skills: opts.skills ?? ['界矢北'],
    vars: opts.vars ?? {},
    marks: opts.marks ?? [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeArmorMarks(count: number, startSeq = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${ARMOR_PREFIX}${startSeq + i}`,
    scope: 0,
  }));
}

function armorCount(p: PlayerState): number {
  return p.marks.filter((m) => m.id.startsWith(ARMOR_PREFIX)).length;
}

function damageCount(p: PlayerState): number {
  const v = p.vars[DAMAGE_COUNT_KEY];
  return typeof v === 'number' ? v : 0;
}

describe('界矢北', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 游戏开始初始化:首次 回合开始 → +3 护甲 ────────────────────
  it('游戏开始初始化:首次 回合开始 → 获得 3 点护甲', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0' }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    expect(armorCount(harness.state.players[0])).toBe(0);

    // 触发任意玩家回合开始(主公开局)
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(armorCount(harness.state.players[0])).toBe(3);
  });

  // ─── 2. 游戏开始初始化仅触发一次 ────────────────────
  it('游戏开始初始化仅触发一次', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0' }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(armorCount(harness.state.players[0])).toBe(3);

    // 第二轮回合开始:不应再加护甲
    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    expect(armorCount(harness.state.players[0])).toBe(3);
  });

  // ─── 3. 护甲减伤:1 伤害 → 0 实伤,护甲 -1,不触发回血/失血 ────────────────────
  it('护甲减伤:1 伤害 → 0 实伤,护甲 -1,不触发首伤回血', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 3,
          marks: makeArmorMarks(3),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const healthBefore = harness.state.players[0].health;
    void runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(healthBefore); // 全吸收
    expect(armorCount(harness.state.players[0])).toBe(2); // -1
    expect(damageCount(harness.state.players[0])).toBe(0); // 未"受到伤害"
  });

  // ─── 4. 护甲减伤:3 伤害(护甲满) → 0 实伤,护甲归零 ────────────────────
  it('护甲减伤:3 伤害(护甲满) → 0 实伤,护甲归零', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 3,
          marks: makeArmorMarks(3),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const healthBefore = harness.state.players[0].health;
    void runDamageFlow(harness.state, 1, 0, 3);
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(healthBefore); // 全吸收
    expect(armorCount(harness.state.players[0])).toBe(0); // 归零
    expect(damageCount(harness.state.players[0])).toBe(0); // 未"受到伤害"
  });

  // ─── 5. 护甲减伤:5 伤害(护甲 3) → 2 实伤,护甲归零,触发首伤回 1 血 ────
  it('护甲部分吸收:5 伤害(护甲 3) → 2 实伤,触发首伤回 1 血', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 3,
          marks: makeArmorMarks(3),
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void runDamageFlow(harness.state, 1, 0, 5);
    await harness.waitForStable();

    // 3 护甲吸收 3,实际受伤 2,首伤回 1 血 → 净失血 1 (3 → 2)
    expect(harness.state.players[0].health).toBe(2);
    expect(armorCount(harness.state.players[0])).toBe(0);
    expect(damageCount(harness.state.players[0])).toBe(1); // 计入受伤次数
  });

  // ─── 6. 首次受伤(无护甲):回 1 血(净效果 0) ────────────────────
  it('首次受伤(无护甲):扣 1 后回 1,净效果 0', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', health: 3 }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(3); // 净 0
    expect(damageCount(harness.state.players[0])).toBe(1);
  });

  // ─── 7. 再伤(同回合):失 1 血 ────────────────────
  it('再伤(同回合):扣伤害后再失 1 体力', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 3,
          vars: { [DAMAGE_COUNT_KEY]: 1 }, // 已受过一次伤
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    void runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();

    // 扣 1 (伤害) + 失 1 (锁定技) → 3-2=1
    expect(harness.state.players[0].health).toBe(1);
    expect(damageCount(harness.state.players[0])).toBe(2);
  });

  // ─── 8. 跨回合重置:新回合首次受伤回血 ────────────────────
  it('跨回合重置:回合结束 → 新回合首次受伤回血', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 2, // 已受伤
          vars: { [DAMAGE_COUNT_KEY]: 2 }, // 上回合已受伤 2 次
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 触发回合结束(清空 damageCount/usedThisTurn)
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    expect(damageCount(harness.state.players[0])).toBe(0);

    // 新回合首次受伤 → 回血(净 0)
    void runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();

    expect(harness.state.players[0].health).toBe(2); // 净 0
    expect(damageCount(harness.state.players[0])).toBe(1);
  });

  // ─── 9. 护甲全吸收(0 实伤)不计入"受到伤害"次数 ────────────────────
  it('护甲全吸收不计入受伤次数', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          health: 3,
          marks: makeArmorMarks(1), // 仅 1 点护甲
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 1 点伤害被护甲全吸收
    void runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(3);
    expect(armorCount(harness.state.players[0])).toBe(0);
    expect(damageCount(harness.state.players[0])).toBe(0);

    // 再受 1 点伤害(护甲已耗尽)→ 首次实伤 → 回血(净 0)
    void runDamageFlow(harness.state, 1, 0, 1);
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(3); // 净 0
    expect(damageCount(harness.state.players[0])).toBe(1);
  });
});
