// 离间(貂蝉·群·主动技)测试
//   出牌阶段限一次,弃一张牌,令一名男性角色视为对另一名男性角色使用决斗。
//
// 验证:
//   1. 正面:P1 离间 → P2(A)决斗 P3(B)→ P3 不出杀 → P3 扣 1 血
//   2. 正面:双方轮流出杀后 P3 不出 → P3 扣血
//   3. 每回合限一次:第二次被拒
//   4. 不能选女性角色(貂蝉本人)
//   5. A 和 B 不能相同
//   6. 手牌不足(无牌可弃)被拒
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
    skills: opts.skills ?? ['杀'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function buildState(opts?: {
  p1Hand?: string[];
  p2Hand?: string[];
  p3Hand?: string[];
  extraCards?: Record<string, Card>;
}): GameState {
  const cards: Record<string, Card> = { ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        character: '貂蝉',
        hand: opts?.p1Hand ?? [],
        skills: ['离间', '闭月'],
        health: 3,
        maxHealth: 3,
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        character: '关羽',
        hand: opts?.p2Hand ?? [],
        skills: ['杀'],
      }),
      makePlayer({
        index: 2,
        name: 'P3',
        character: '曹操',
        hand: opts?.p3Hand ?? [],
        skills: ['杀'],
      }),
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('离间', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:P3(B/目标)不出杀 → P3 扣 1 血 ─────────────
  it('P1 离间 [P2→P3] → 无懈 pass → P3 不出杀 → P3 扣 1 血,P1 弃牌', async () => {
    const discard = makeCard('d1', '闪', '♥', '2', '基本牌');
    const state = buildState({
      p1Hand: ['d1'],
      p2Hand: [],
      p3Hand: [],
      extraCards: { d1: discard },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const p3HealthBefore = harness.state.players[2].health;

    // 发动离间:弃 d1,P2(A)对 P3(B)决斗
    await P1.triggerAction('离间', 'use', { cardId: 'd1', targets: [1, 2] });

    // 窗口 1:无懈可击(broadcast)→ pass
    P1.expectPending('请求回应');
    await P1.pass();

    // 窗口 2:P3(B/目标)被询问出杀 → pass(不出)
    const P3 = harness.player('P3');
    P3.expectPending('询问杀');
    await P3.pass();

    // P3 不出杀 = 输 → 受 1 点伤害
    expect(harness.state.players[2].health).toBe(p3HealthBefore - 1);
    // P2 未受伤
    expect(harness.state.players[1].health).toBe(4);
    // d1 进弃牌堆
    expect(harness.state.zones.discardPile).toContain('d1');
    // P1 手牌为空
    expect(harness.state.players[0].hand).toEqual([]);
  });

  // ─── 2. 双方轮流出杀:P3 出杀 → P2 出杀 → P3 不出 → P3 扣血 ─
  it('P3 出杀 → P2 出杀 → P3 再被询问 → pass → P3 扣 1 血', async () => {
    const discard = makeCard('d1', '闪', '♥', '2');
    const s2 = makeCard('s2', '杀', '♠', '5');
    const s3 = makeCard('s3', '杀', '♥', '7');
    const state = buildState({
      p1Hand: ['d1'],
      p2Hand: ['s2'],
      p3Hand: ['s3'],
      extraCards: { d1: discard, s2, s3 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    const p2HealthBefore = harness.state.players[1].health;
    const p3HealthBefore = harness.state.players[2].health;

    await P1.triggerAction('离间', 'use', { cardId: 'd1', targets: [1, 2] });

    // 无懈可击 → pass
    await P1.pass();

    // P3(B)出杀
    P3.expectPending('询问杀');
    await P3.respond('杀', { cardId: 's3' });

    // P2(A)出杀
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 's2' });

    // P3(B)再被询问 → pass(没杀可出了)
    P3.expectPending('询问杀');
    await P3.pass();

    // P3 输 → 扣 1 血;P2 无伤
    expect(harness.state.players[2].health).toBe(p3HealthBefore - 1);
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
    // 两张杀进弃牌堆
    expect(harness.state.zones.discardPile).toContain('s2');
    expect(harness.state.zones.discardPile).toContain('s3');
  });

  // ─── 3. A 出杀后 B 直接不出 → B 扣血(A 赢) ────────────────
  it('P3 不出杀 → P3 扣血,P2 不受伤(无需 A 出杀即可定胜负)', async () => {
    const discard = makeCard('d1', '闪', '♥', '2');
    const state = buildState({
      p1Hand: ['d1'],
      p2Hand: [],
      p3Hand: [],
      extraCards: { d1: discard },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    await P1.triggerAction('离间', 'use', { cardId: 'd1', targets: [1, 2] });

    await P1.pass(); // 无懈

    P3.expectPending('询问杀');
    await P3.pass();

    expect(harness.state.players[2].health).toBe(3); // 4-1
    expect(harness.state.players[1].health).toBe(4); // P2 无伤
  });

  // ─── 4. 每回合限一次:第二次被拒 ───────────────────────────
  it('每回合限一次:第二次离间被拒', async () => {
    const d1 = makeCard('d1', '闪', '♥', '2');
    const d2 = makeCard('d2', '闪', '♣', '3');
    const state = buildState({
      p1Hand: ['d1', 'd2'],
      p3Hand: [],
      extraCards: { d1, d2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    // 第一次离间
    await P1.triggerAction('离间', 'use', { cardId: 'd1', targets: [1, 2] });
    await P1.pass(); // 无懈
    await P3.pass(); // P3 不出杀

    // 第二次离间 → 被拒
    await P1.expectRejected({
      skillId: '离间',
      actionType: 'use',
      params: { cardId: 'd2', targets: [1, 2] },
    });
  });

  // ─── 5. 不能选女性角色(貂蝉本人)作为目标 ──────────────────
  it('不能选貂蝉(女性)作为目标', async () => {
    const d1 = makeCard('d1', '闪', '♥', '2');
    const state = buildState({
      p1Hand: ['d1'],
      extraCards: { d1 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 选 P1(貂蝉/女)作为 A → 被拒
    await P1.expectRejected({
      skillId: '离间',
      actionType: 'use',
      params: { cardId: 'd1', targets: [0, 2] },
    });
    // 选 P1(貂蝉/女)作为 B → 被拒
    await P1.expectRejected({
      skillId: '离间',
      actionType: 'use',
      params: { cardId: 'd1', targets: [1, 0] },
    });
  });

  // ─── 6. A 和 B 不能相同 ──────────────────────────────────
  it('A 和 B 不能是同一个角色', async () => {
    const d1 = makeCard('d1', '闪', '♥', '2');
    const state = buildState({
      p1Hand: ['d1'],
      extraCards: { d1 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '离间',
      actionType: 'use',
      params: { cardId: 'd1', targets: [1, 1] },
    });
  });

  // ─── 7. 无牌可弃 → 被拒 ──────────────────────────────────
  it('无手牌/装备时不能发动离间', async () => {
    const state = buildState({
      p1Hand: [],
      extraCards: {},
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '离间',
      actionType: 'use',
      params: { cardId: 'nonexistent', targets: [1, 2] },
    });
  });

  // ─── 8. 非出牌阶段 → 被拒 ────────────────────────────────
  it('非出牌阶段不能发动离间', async () => {
    const d1 = makeCard('d1', '闪', '♥', '2');
    const state = buildState({
      p1Hand: ['d1'],
      extraCards: { d1 },
    });
    state.phase = '弃牌';
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '离间',
      actionType: 'use',
      params: { cardId: 'd1', targets: [1, 2] },
    });
  });

  // ─── 9. 弃置装备牌也可以 ─────────────────────────────────
  it('可以弃置装备牌发动离间', async () => {
    const weapon = makeCard('wp1', '诸葛连弩', '♣', '1', '装备牌');
    const state = buildState({
      p1Hand: [],
      p3Hand: [],
      extraCards: { wp1: weapon },
    });
    // 给 P1 装备武器
    state.players[0].equipment = { 武器: 'wp1' };
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    await P1.triggerAction('离间', 'use', { cardId: 'wp1', targets: [1, 2] });
    await P1.pass(); // 无懈
    await P3.pass(); // P3 不出杀

    // 武器进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wp1');
    expect(harness.state.players[0].equipment['武器']).toBeUndefined();
  });
});
