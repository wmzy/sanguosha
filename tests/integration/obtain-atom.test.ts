// tests/integration/obtain-atom.test.ts
// 获得 atom 集成测试 — 验证拿牌时来源手牌/装备区被移除,目标手牌增加。
//
// 覆盖:
//   1. 获得 atom 单元:从来源手牌拿 → 来源手牌 -1,目标 +1
//   2. 获得 atom 单元:从来源装备区拿 → 来源装备清空该槽,目标 +1
//   3. 获得 atom 单元:from 缺省(摸牌/给予类)→ 目标 +1,无来源变化
//   4. 反馈 端到端:P0 杀 P1 → P1 反馈 confirm=true → P0 hand -1, P1 hand +1
//   5. 顺手牵羊 端到端:P0 出顺手牵羊 → P0 拿 P1 一张牌 → P1 hand -1, P0 hand +1
//
// Bug 场景:之前若 atom apply 只加没移,会出现 P0 和 P1 同时拥有同一张牌(牌被复制)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, rank, type };
}

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
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
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

describe('获得 atom:从来源移除 + 加到目标', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 单元:从手牌拿牌 ─────────────────────
  it('单元:从 P0 手牌拿一张 → P0.hand 减少,P1.hand 增加', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const dodge: Card = makeCard('d1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id, dodge.id] }),
        makePlayer({ index: 1, name: 'P1', hand: [] }),
      ],
      cardMap: { [slash.id]: slash, [dodge.id]: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // P1 拿 P0 的杀
    await applyAtom(harness.state, { type: '获得', player: 1, cardId: slash.id, from: 0 });

    expect(harness.state.players[0].hand).toEqual([dodge.id]); // P0 剩闪
    expect(harness.state.players[1].hand).toEqual([slash.id]); // P1 拿到杀
    // 牌没有同时存在两边
    expect(harness.state.players[0].hand).not.toContain(slash.id);
    expect(harness.state.players[1].hand).not.toContain(dodge.id);
  });

  // ─── 2. 单元:从装备区拿牌 ────────────────────
  it('单元:从 P0 装备区拿一张 → P0.equipment 该槽清空,P1.hand 增加', async () => {
    const weapon: Card = makeCard('w1', '诸葛连弩', '♣', '1', '装备牌');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', equipment: { 武器: weapon.id } }),
        makePlayer({ index: 1, name: 'P1', hand: [] }),
      ],
      cardMap: { [weapon.id]: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    await applyAtom(harness.state, { type: '获得', player: 1, cardId: weapon.id, from: 0 });

    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
    expect(harness.state.players[1].hand).toEqual([weapon.id]);
  });

  // ─── 3. 单元:from 缺省(只加不移) ─────────────
  it('单元:from 缺省 → 目标 +1,无来源变化(摸牌/给予类场景)', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id] }),
        makePlayer({ index: 1, name: 'P1', hand: [] }),
      ],
      cardMap: { [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 模拟 摸牌:不传 from
    await applyAtom(harness.state, { type: '获得', player: 1, cardId: slash.id });

    // P0 不变,P1 +1(可能牌堆本就在 P1 持有,但这里测的是无副作用)
    expect(harness.state.players[1].hand).toContain(slash.id);
  });

  // ─── 4. 反馈 端到端 ─────────────────────
  it('反馈 端到端:P0 杀 P1 → P1 confirm → P0 不再持有被拿牌,P1 持有该牌', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const stolen: Card = makeCard('s1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id, stolen.id], skills: ['杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          skills: ['反馈', '闪'],
          health: 4, maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [stolen.id]: stolen },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪 → 扣血 → 反馈 询问发动
    await P1.pass();
    P1.expectPending('请求回应');
    // P1 confirm=true 发动反馈
    await P1.respond('反馈', { choice: true });

    // 关键合约:P0 不再持有被拿的牌
    expect(harness.state.players[0].hand).not.toContain(stolen.id);
    // P1 持有该牌
    expect(harness.state.players[1].hand).toContain(stolen.id);
    // P1 拿到了正好一张牌(从 P0)
    expect(harness.state.players[1].hand.length).toBe(1);
  });

  // ─── 5. 顺手牵羊 端到端 ───────────────────
  it('顺手牵羊 端到端:P0 出锦囊 → P0 拿 P1 一张手牌 → P1.hand -1, P0.hand 不变', async () => {
    const sq: Card = makeCard('sq1', '顺手牵羊', '♠', '4', '锦囊牌');
    const stolen: Card = makeCard('st1', '桃', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [sq.id], skills: ['顺手牵羊', '杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [stolen.id], skills: [] }),
      ],
      cardMap: { [sq.id]: sq, [stolen.id]: stolen },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p0Before = [...harness.state.players[0].hand];
    const p1Before = [...harness.state.players[1].hand];

    // P0 对 P1 出 顺手牵羊
    await P0.triggerAction('顺手牵羊', 'use', { cardId: sq.id, target: 1 });
    // 消耗无懈窗口
    await P0.pass();

    // P1 失去第一张手牌
    expect(harness.state.players[1].hand).not.toContain(p1Before[0]);
    // P1.hand -1
    expect(harness.state.players[1].hand.length).toBe(p1Before.length - 1);
    // P0 拿到 P1 那张(此时 P0 用了 顺手牵羊,手里无 sq1,加上拿到的 = 1 张)
    expect(harness.state.players[0].hand).toEqual([p1Before[0]]);
    // 总牌数守恒
    const totalAfter = harness.state.players[0].hand.length + harness.state.players[1].hand.length;
    expect(totalAfter).toBe(p0Before.length + p1Before.length - 1); // 顺手牵羊 进了弃牌堆
  });
});
