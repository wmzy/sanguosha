// tests/integration/taoyuan.test.ts
// 集成测试:桃园结义(普通锦囊)多人回血。
//
// 覆盖:
//   1. 多人各回 1 血:P1/P2/P3 各 HP+1
//   2. 满血不超 maxHealth:满血玩家不回血(HP=4 不变)
//   3. 锦囊卡进弃牌堆;处理区清空
//   4. 跨回合:桃园结义使用后状态稳定,无残留 pending
//
// 关键机制(桃园结义.ts):
//   use → applyAtom 移动牌到处理区 → 逐目标结算:
//     满血目标(HP>=maxHealth)跳过(不询问无懈也不回血,无可抵消的效果)
//     未满血目标 → 请求回应 无懈可击(broadcast)→ 若未被抵消则回复体力(+1)
//   → 移动牌到弃牌堆
//
// 模式:SkillTestHarness + useCard + pass(跳过 无懈可击 窗口)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  health?: number;
  maxHealth?: number;
  skills?: string[];
  alive?: boolean;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: opts.alive ?? true,
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

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♥',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

describe('桃园结义:多人回血端到端', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:P1/P2/P3 各 HP+1(每人掉 1 血后用 桃园结义)
  // ─────────────────────────────────────────────────────────────
  it('用例1:3 人各 HP+1,锦囊进弃牌堆', async () => {
    const ty: Card = makeCard('ty1', '桃园结义', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [ty.id],
          health: 2,
          maxHealth: 4,
          skills: ['桃园结义'],
        }),
        makePlayer({ index: 1, name: 'P2', health: 1, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P3', health: 3, maxHealth: 4 }),
      ],
      cardMap: { [ty.id]: ty },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');

    await P1.useCard('桃园结义', ty.id);
    // 跳过 无懈可击 窗口(逐目标广播,3 个存活目标各一次)
    for (let i = 0; i < 3; i++) await P1.pass();

    // 各回 1 血
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.players[2].health).toBe(4);
    // 锦囊进弃牌堆,处理区清空
    expect(harness.state.zones.discardPile).toContain(ty.id);
    expect(harness.state.zones.processing).not.toContain(ty.id);
    // P1 手牌已空(桃园结义被打出)
    expect(harness.state.players[0].hand).not.toContain(ty.id);
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:满血不超 maxHealth
  // ─────────────────────────────────────────────────────────────
  it('用例2:满血玩家(4/4)使用 桃园结义 → 仍为 4 血,不超 maxHealth', async () => {
    const ty: Card = makeCard('ty1', '桃园结义', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [ty.id],
          health: 4,
          maxHealth: 4,
          skills: ['桃园结义'],
        }),
        makePlayer({ index: 1, name: 'P2', health: 4, maxHealth: 4 }),
      ],
      cardMap: { [ty.id]: ty },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.useCard('桃园结义', ty.id);
    // P1/P2 均满血 → 不询问无懈可击(useCard 内 waitForStable 即结算完成)

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(4);
    // 锦囊进弃牌堆
    expect(harness.state.zones.discardPile).toContain(ty.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:混合状态:有人满血有人不满 → 满血不回,不满回 1
  // ─────────────────────────────────────────────────────────────
  it('用例3:混合状态(P1 满血 P2 掉血 P3 满血) → 仅 P2 回 1 血', async () => {
    const ty: Card = makeCard('ty1', '桃园结义', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [ty.id],
          health: 4,
          maxHealth: 4,
          skills: ['桃园结义'],
        }),
        makePlayer({ index: 1, name: 'P2', health: 2, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P3', health: 4, maxHealth: 4 }),
      ],
      cardMap: { [ty.id]: ty },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.useCard('桃园结义', ty.id);
    // 仅 P2 未满血 → 只对 P2 询问无懈(P1/P3 满血不问询),1 次 pass
    for (let i = 0; i < 1; i++) await P1.pass();

    // P1 满血 → 4(不动);P2 掉血 → 3(+1);P3 满血 → 4(不动)
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[2].health).toBe(4);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:4 人局(覆盖"全员"路径)→ 全员回 1 血
  // ─────────────────────────────────────────────────────────────
  it('用例4:4 人局全员回 1 血', async () => {
    const ty: Card = makeCard('ty1', '桃园结义', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [ty.id],
          health: 3,
          maxHealth: 4,
          skills: ['桃园结义'],
        }),
        makePlayer({ index: 1, name: 'P2', health: 2, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P3', health: 1, maxHealth: 4 }),
        makePlayer({ index: 3, name: 'P4', health: 3, maxHealth: 4 }),
      ],
      cardMap: { [ty.id]: ty },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.useCard('桃园结义', ty.id);
    // 跳过 无懈可击 窗口(逐目标广播,4 个存活目标各一次)
    for (let i = 0; i < 4; i++) await P1.pass();

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[2].health).toBe(2);
    expect(harness.state.players[3].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain(ty.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5:死亡玩家不回复(且不消耗 atom)
  // ─────────────────────────────────────────────────────────────
  it('用例5:存在死亡玩家 → 跳过死亡玩家,仅存活者回血', async () => {
    const ty: Card = makeCard('ty1', '桃园结义', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: [ty.id],
          health: 3,
          maxHealth: 4,
          skills: ['桃园结义'],
        }),
        // P2 死亡
        makePlayer({ index: 1, name: 'P2', health: 0, maxHealth: 4, alive: false }),
        makePlayer({ index: 2, name: 'P3', health: 2, maxHealth: 4 }),
      ],
      cardMap: { [ty.id]: ty },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.useCard('桃园结义', ty.id);
    // 跳过 无懈可击 窗口(P2 死亡不触发,2 个存活目标各一次)
    for (let i = 0; i < 2; i++) await P1.pass();

    // P1 +1(3→4)、P2 跳过(死亡,0→0)、P3 +1(2→3)
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(0);
    expect(harness.state.players[1].alive).toBe(false);
    expect(harness.state.players[2].health).toBe(3);
  });
});
