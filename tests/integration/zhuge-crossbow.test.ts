// tests/integration/zhuge-crossbow.test.ts
// 集成测试:诸葛连弩 → 杀quota=Infinity → 连续出杀 → 卸载后恢复。
//
// 覆盖:
//   1. 装备诸葛连弩 → quota 设为 Infinity → 连续出多张杀(2 张 +)
//   2. 卸载诸葛连弩(替换装备) → 诸葛连弩 skill 实例被卸载
//   3. 卸载后 quota 状态(已知引擎 BUG:不主动清 quota,Infinity 残留直到出杀扣减)
//      → 这里只断言"换装后诸葛连弩 skill 已不在玩家技能列表"
//
// 模式:SkillTestHarness + useCard('装备通用') + useCardAndTarget('杀') + pass(闪)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';
import { slashMax } from '../../src/engine/slash-quota';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = '7',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  subtype?: string,
  range?: number,
): Card {
  return { id, name, suit, rank, type, subtype, range };
}

describe('诸葛连弩:上限提供者(∞) + 连续出杀 + 卸载', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:装备诸葛连弩 → 注册上限提供者(∞) → 连续出 2 张杀
  // ─────────────────────────────────────────────────────────────
  it('用例1:装备诸葛连弩后,上限 = ∞,同回合连续出 2 张杀(P1 扣 2 血)', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);
    const slash1: Card = makeCard('k1', '杀', '♠', '7');
    const slash2: Card = makeCard('k2', '杀', '♣', '8');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, slash1.id, slash2.id],
          skills: ['杀', '装备通用', '诸葛连弩'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'], health: 4 }),
      ],
      cardMap: { [zhuge.id]: zhuge, [slash1.id]: slash1, [slash2.id]: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const healthBefore = harness.state.players[1].health;

    // 装诸葛连弩 → onInit 注册上限提供者(∞) → slashMax = ∞
    await P0.useCard('装备通用', zhuge.id);
    expect(harness.state.players[0].equipment['武器']).toBe(zhuge.id);
    expect(slashMax(harness.state, 0)).toBe(Infinity);
    expect(harness.state.players[0].skills).toContain('诸葛连弩');

    // 第一张杀(usedCount 0 → 1;上限 ∞ → 可出)
    await P0.useCardAndTarget('杀', slash1.id, [1]);
    await P1.pass();
    expect(harness.state.players[1].health).toBe(healthBefore - 1);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);

    // 第二张杀:usedCount(1) < ∞ → 仍可出
    await P0.useCardAndTarget('杀', slash2.id, [1]);
    await P1.pass();
    expect(harness.state.players[1].health).toBe(healthBefore - 2);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(2);

    // 两张杀都进弃牌堆
    expect(harness.state.zones.discardPile).toContain(slash1.id);
    expect(harness.state.zones.discardPile).toContain(slash2.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:卸载(替换)诸葛连弩 → 诸葛连弩 skill 实例从 players.skills 移除
  // ─────────────────────────────────────────────────────────────
  it('用例2:换装成青釭剑 → 诸葛连弩 skill 被卸载', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);
    const sword: Card = makeCard('wp-qg', '青釭剑', '♠', '6', '装备牌', '武器', 2);

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, sword.id],
          skills: ['杀', '装备通用', '诸葛连弩', '青釭剑'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [zhuge.id]: zhuge, [sword.id]: sword },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');

    // 装诸葛连弩
    await P0.useCard('装备通用', zhuge.id);
    expect(harness.state.players[0].equipment['武器']).toBe(zhuge.id);
    expect(harness.state.players[0].skills).toContain('诸葛连弩');
    expect(slashMax(harness.state, 0)).toBe(Infinity);

    // 换装成青釭剑 → 诸葛连弩 skill 被卸载,旧装备进弃牌堆
    await P0.useCard('装备通用', sword.id);
    expect(harness.state.players[0].equipment['武器']).toBe(sword.id);
    expect(harness.state.players[0].skills).not.toContain('诸葛连弩');
    expect(harness.state.players[0].skills).toContain('青釭剑');
    expect(harness.state.zones.discardPile).toContain(zhuge.id);

    // 卸载函数取消注册上限提供者 → slashMax 回到 1;usedCount 保留(未出过杀仍为 undefined/0)
    expect(slashMax(harness.state, 0)).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 3:装连弩期间出过杀 → 换装后 usedCount 保留 → 不能再出杀
  //   新模型(分离 usedCount 与上限来源)的核心正确性保证:
  //   旧 杀/quota 方案下换装重置 quota 会丢失"已出过杀"信息;
  //   新方案 usedCount 不受装备增删影响 → 正确拒绝。
  // ─────────────────────────────────────────────────────────────
  it('装连弩期间出过 1 杀 → 换青釭剑后第二张杀被拒(usedCount 保留)', async () => {
    const zhuge: Card = makeCard('wp-zg', '诸葛连弩', '♣', 'A', '装备牌', '武器', 1);
    const sword: Card = makeCard('wp-qg', '青釭剑', '♠', '6', '装备牌', '武器', 2);
    const slash1: Card = makeCard('k1', '杀', '♠', '7');
    const slash2: Card = makeCard('k2', '杀', '♣', '8');

    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0, name: 'P0',
          hand: [zhuge.id, sword.id, slash1.id, slash2.id],
          skills: ['杀', '装备通用', '诸葛连弩', '青釭剑'],
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'], health: 4 }),
      ],
      cardMap: { [zhuge.id]: zhuge, [sword.id]: sword, [slash1.id]: slash1, [slash2.id]: slash2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const healthBefore = harness.state.players[1].health;

    // 装诸葛连弩 → 注册上限提供者 → 上限 ∞
    await P0.useCard('装备通用', zhuge.id);
    expect(slashMax(harness.state, 0)).toBe(Infinity);

    // 第一张杀:上限 ∞ → 成功(usedCount 0 → 1)
    await P0.useCardAndTarget('杀', slash1.id, [1]);
    await P1.pass();
    expect(harness.state.players[1].health).toBe(healthBefore - 1);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);

    // 换装青釭剑 → 卸载上限提供者 → 上限回到 1;usedCount 仍为 1
    await P0.useCard('装备通用', sword.id);
    expect(slashMax(harness.state, 0)).toBe(1);
    expect(harness.state.turn.vars['杀/usedCount']).toBe(1);

    // 第二张杀:usedCount(1) >= 上限(1) → 被拒(关键修复点)
    await P0.expectRejected({ skillId: '杀', actionType: 'use', params: { cardId: slash2.id, targets: [1] } });
  });
});
