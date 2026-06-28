// tests/integration/taoyuan-heal.test.ts
// 集成测试:桃园结义多人回血 + 满血不超 maxHealth。
//
// 覆盖(与 tests/integration/taoyuan.test.ts 互补):
//   1. 满血不超 maxHealth:3 人满血 → 桃园结义 → HP 不变(4 仍为 4)
//   2. 满血不超 maxHealth(4 人):4 人满血 → 桃园结义 → HP 不变
//   3. 满血 + 不满 混合:满血者不动(且不问询无懈),不满者 +1
//   4. 跨回合稳定:使用后无残留 pending,处理区清空
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

describe('桃园结义:满血不超 maxHealth', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:3 人满血 → 桃园结义 → HP 不变
  // ─────────────────────────────────────────────────────────────
  it('用例1:3 人满血(4/4) → 桃园结义 → HP 不超 maxHealth(仍 4)', async () => {
    const ty: Card = makeCard('ty1', '桃园结义', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [ty.id], health: 4, maxHealth: 4, skills: ['桃园结义'] }),
        makePlayer({ index: 1, name: 'P2', health: 4, maxHealth: 4 }),
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
    // 3 人均满血 → 不询问无懈可击(useCard 内 waitForStable 即结算完成)

    // 满血 → 仍 4(不超 maxHealth)
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[2].health).toBe(4);
    // 锦囊进弃牌堆
    expect(harness.state.zones.discardPile).toContain(ty.id);
    expect(harness.state.zones.processing).not.toContain(ty.id);
    // P1 手牌已空
    expect(harness.state.players[0].hand).not.toContain(ty.id);
    // 无残留 pending
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:4 人满血 → 桃园结义 → HP 不变
  // ─────────────────────────────────────────────────────────────
  it('用例2:4 人满血(4/4) → 桃园结义 → HP 不超 maxHealth', async () => {
    const ty: Card = makeCard('ty1', '桃园结义', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [ty.id], health: 4, maxHealth: 4, skills: ['桃园结义'] }),
        makePlayer({ index: 1, name: 'P2', health: 4, maxHealth: 4 }),
        makePlayer({ index: 2, name: 'P3', health: 4, maxHealth: 4 }),
        makePlayer({ index: 3, name: 'P4', health: 4, maxHealth: 4 }),
      ],
      cardMap: { [ty.id]: ty },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.useCard('桃园结义', ty.id);
    // 4 人均满血 → 不询问无懈可击(useCard 内 waitForStable 即结算完成)

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[2].health).toBe(4);
    expect(harness.state.players[3].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain(ty.id);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:满血 + 不满 混合 → 满血不动,不满 +1
  // ─────────────────────────────────────────────────────────────
  it('用例3:混合状态(P1 满血 P2 掉血 P3 满血) → 仅 P2 回 1 血,满血者不变', async () => {
    const ty: Card = makeCard('ty1', '桃园结义', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [ty.id], health: 4, maxHealth: 4, skills: ['桃园结义'] }),
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
    expect(harness.state.zones.discardPile).toContain(ty.id);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 4:接近满血(maxHealth-1)→ 桃园结义 → +1 后正好等于 maxHealth(边界)
  // ─────────────────────────────────────────────────────────────
  it('用例4:边界(P2 HP=3 maxHealth=4) → 桃园结义 → HP=4(= maxHealth)', async () => {
    const ty: Card = makeCard('ty1', '桃园结义', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [ty.id], health: 3, maxHealth: 4, skills: ['桃园结义'] }),
        makePlayer({ index: 1, name: 'P2', health: 3, maxHealth: 4 }),
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

    // 全员 3 → 4(正好等于 maxHealth,没有超过)
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[2].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain(ty.id);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 5:已满血玩家不会因为 桃园结义 突破 maxHealth(不可能但需断言保护)
  // ─────────────────────────────────────────────────────────────
  it('用例5:HP=4 maxHealth=4 → +1 后仍是 4(不超 maxHealth,assertion 锁死)', async () => {
    const ty: Card = makeCard('ty1', '桃园结义', '♥', 'A');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [ty.id], health: 4, maxHealth: 4, skills: ['桃园结义'] }),
        makePlayer({ index: 1, name: 'P2', health: 1, maxHealth: 4 }),
      ],
      cardMap: { [ty.id]: ty },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.useCard('桃园结义', ty.id);
    // 仅 P2 未满血 → 只对 P2 询问无懈(P1 满血不问询),1 次 pass
    for (let i = 0; i < 1; i++) await P1.pass();

    // P1 满血 4 → 4(不超);P2 1 → 2(+1)
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(2);
    // 关键 assertion:HP 永远不超过 maxHealth
    for (const p of harness.state.players) {
      expect(p.health).toBeLessThanOrEqual(p.maxHealth);
    }
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
