// 闭月(貂蝉·群·被动技)测试
//   回合结束阶段,你可以摸一张牌。
//
// 验证:
//   1. 发动闭月 → 摸 1 张
//   2. 不发动闭月 → 不摸牌
//   3. 闭月只在回合结束阶段触发(出牌阶段不触发)
//
// 测试手法:P1(貂蝉)从出牌阶段点"结束回合"→ 阶段链推进到回合结束阶段 →
// 闭月 after-hook 询问是否摸牌。P2 不设 回合管理 避免下家回合启动干扰断言。
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
  p1Skills?: string[];
  extraCards?: Record<string, Card>;
  deck?: string[];
}): GameState {
  const cards: Record<string, Card> = { ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        character: '貂蝉',
        hand: opts?.p1Hand ?? [],
        skills: opts?.p1Skills ?? ['闭月', '回合管理'],
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

describe('闭月', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 发动闭月 → 摸 1 张 ─────────────────────────────
  it('回合结束阶段发动闭月:摸 1 张牌', async () => {
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
    await P1.respond('闭月', { choice: true }); // 发动闭月

    // 闭月摸 1 张
    expect(harness.state.players[0].hand.length).toBe(1);
    // 牌堆消耗 1 张
    expect(harness.state.zones.deck.length).toBe(2);
  });

  // ─── 2. 不发动闭月 → 不摸牌 ─────────────────────────
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
    await P1.respond('闭月', { choice: false }); // 不发动

    // 不摸牌
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.zones.deck.length).toBe(2);
  });

  // ─── 3. 出牌阶段不触发闭月 ────────────────────────────
  it('出牌阶段不触发闭月(只在回合结束阶段)', async () => {
    const d1 = makeCard('d1', '杀', '♠', '2');
    const state = buildState({
      p1Hand: ['d1'],
      extraCards: { d1 },
      deck: [],
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 出牌阶段:无闭月询问 pending(出牌窗口是非阻塞 pending,非请求回应)
    // 闭月 hook 不会在出牌阶段触发
    const slots = [...harness.state.pendingSlots.values()];
    // 出牌阶段可能有出牌窗口 pending,但不应该有 闭月/confirm 请求
    const bimoonPending = slots.find((s) => {
      const atom = s.atom as Record<string, unknown>;
      return atom['requestType'] === '闭月/confirm';
    });
    expect(bimoonPending).toBeUndefined();
    // P1 手牌不变(没摸牌)
    expect(harness.state.players[0].hand).toEqual(['d1']);
  });

  // ─── 4. 闭月超时(默认不发动)→ 不摸牌 ──────────────────
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
