// 界闭月(界貂蝉·群·被动技)测试
//   结束阶段,若你没有手牌,你可以摸两张牌,否则你可以摸一张牌。
//
// 验证:
//   1. 无手牌 → 发动闭月 → 摸 2 张(界版强化)
//   2. 有手牌 → 发动闭月 → 摸 1 张(与标版相同)
//   3. 不发动闭月 → 不摸牌
//   4. 闭月只在回合结束阶段触发(出牌阶段不触发)
//   5. 闭月超时默认不发动 → 不摸牌
//
// 测试手法:P1(界貂蝉)从出牌阶段点"结束回合"→ 阶段链推进到回合结束阶段 →
// 界闭月 after-hook 询问是否摸牌(张数依手牌数)。P2 不设 回合管理 避免下家回合启动干扰断言。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
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
  character: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
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

function buildState(opts?: {
  p1Hand?: string[];
  extraCards?: Record<string, Card>;
  deck?: string[];
}): GameState {
  const cards: Record<string, Card> = { ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        character: '界貂蝉',
        hand: opts?.p1Hand ?? [],
        skills: ['界闭月', '回合管理'],
        health: 3,
        maxHealth: 3,
      }),
      // P2 不设 回合管理,避免 P1 回合结束后启动 P2 回合干扰断言
      makePlayer({ index: 1, name: 'P2', character: '关羽', skills: [] }),
    ],
    cardMap: cards,
    zones: { deck: opts?.deck ?? [], discardPile: [], processing: [] },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界闭月', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 无手牌发动闭月 → 摸 2 张(界版强化) ───────────────
  it('回合结束阶段无手牌发动闭月:摸 2 张牌', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const d3 = makeCard('d3', '桃', '♦', '4');
    const state = buildState({
      p1Hand: [],
      extraCards: { d1, d2, d3 },
      deck: ['d1', 'd2', 'd3'],
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 结束回合:出牌→弃牌→回合结束阶段
    await P1.triggerAction('回合管理', 'end');

    // 回合结束阶段:闭月询问是否摸牌
    P1.expectPending('请求回应');
    await P1.respond('界闭月', { choice: true }); // 发动闭月

    // 界版无手牌:摸 2 张
    expect(harness.state.players[0].hand.length).toBe(2);
    // 牌堆消耗 2 张
    expect(harness.state.zones.deck.length).toBe(1);
  });

  // ─── 2. 有手牌发动闭月 → 摸 1 张(与标版相同) ───────────────
  it('回合结束阶段有手牌发动闭月:摸 1 张牌', async () => {
    const hold = makeCard('hold', '杀', '♠', '2');
    const d1 = makeCard('d1', '闪', '♥', '3');
    const d2 = makeCard('d2', '桃', '♦', '4');
    const state = buildState({
      p1Hand: ['hold'],
      extraCards: { hold, d1, d2 },
      deck: ['d1', 'd2'],
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // P1 有 1 张手牌,不会触发弃牌阶段(1 <= hp 3)
    await P1.triggerAction('回合管理', 'end');

    P1.expectPending('请求回应');
    await P1.respond('界闭月', { choice: true }); // 发动闭月

    // 界版有手牌:摸 1 张;加上原有 1 张 → 共 2 张
    expect(harness.state.players[0].hand.length).toBe(2);
    // 牌堆消耗 1 张
    expect(harness.state.zones.deck.length).toBe(1);
    // 原手牌仍在
    expect(harness.state.players[0].hand).toContain('hold');
  });

  // ─── 3. 不发动闭月 → 不摸牌 ─────────────────────────
  it('回合结束阶段不发动闭月:不摸牌', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const state = buildState({
      p1Hand: [],
      extraCards: { d1, d2 },
      deck: ['d1', 'd2'],
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('回合管理', 'end');

    P1.expectPending('请求回应');
    await P1.respond('界闭月', { choice: false }); // 不发动

    // 不摸牌
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.zones.deck.length).toBe(2);
  });

  // ─── 4. 出牌阶段不触发闭月 ────────────────────────────
  it('出牌阶段不触发闭月(只在回合结束阶段)', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const state = buildState({
      p1Hand: ['d1'],
      extraCards: { d1 },
      deck: [],
    });
    await harness.setup(state);

    // 出牌阶段:无闭月询问 pending
    const slots = [...harness.state.pendingSlots.values()];
    // 不应该有 界闭月/confirm 请求
    const bimoonPending = slots.find((s) => {
      const atom = s.atom as Record<string, unknown>;
      return atom['requestType'] === '界闭月/confirm';
    });
    expect(bimoonPending).toBeUndefined();
    // P1 手牌不变(没摸牌)
    expect(harness.state.players[0].hand).toEqual(['d1']);
  });

  // ─── 5. 闭月超时(默认不发动)→ 不摸牌 ──────────────────
  it('闭月超时默认不发动:不摸牌', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const state = buildState({
      p1Hand: [],
      extraCards: { d1 },
      deck: ['d1'],
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('回合管理', 'end');

    P1.expectPending('请求回应');
    await P1.pass(); // 超时(defaultChoice: false → 不发动)

    expect(harness.state.players[0].hand.length).toBe(0);
  });
});
