// tests/skill-tests/桃园结义.test.ts
// 桃园结义(普通锦囊):出牌阶段对所有存活角色使用,每名目标回复 1 点体力。
//
// 覆盖:
//   1. 多人回 1 血:P1 出锦囊,P1/P2/P3 各回 1 血
//   2. 满血不回:P1/P2 已满血,使用后仍为 4 血(不超 maxHealth)
//   2b. 满血不问询无懈:满血目标不产生无懈窗口,仅未满血目标询问
//   3. validate 拒绝(negative):非出牌阶段 / pending 期间 / 牌不在手 / 牌名错
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState, TurnPhase } from '../../src/engine/types';
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
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['桃园结义'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function buildState(opts?: {
  p1Hand?: string[];
  p1Health?: number;
  p2Health?: number;
  p3Health?: number;
  phase?: TurnPhase;
  playerCount?: number;
  extraCards?: Record<string, Card>;
}): GameState {
  const ty = makeCard('ty1', '桃园结义', '♥', 'A');
  const cards: Record<string, Card> = { ty1: ty, ...(opts?.extraCards ?? {}) };
  const n = opts?.playerCount ?? 2;
  const players = [
    makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? ['ty1'], health: opts?.p1Health ?? 3, skills: ['桃园结义'] }),
    makePlayer({ index: 1, name: 'P2', health: opts?.p2Health ?? 3 }),
  ];
  for (let i = 2; i < n; i++) {
    players.push(makePlayer({ index: i, name: `P${i + 1}`, health: opts?.p3Health ?? 3 }));
  }
  return createGameState({
    players,
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: opts?.phase ?? '出牌',
    turn: { round: 1, phase: opts?.phase ?? '出牌', vars: {} },
  });
}

describe('桃园结义', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 正面效果:多人各回 1 血
  // ─────────────────────────────────────────────────────────────
  it('P1 在出牌阶段出桃园结义 → P1/P2/P3 各回 1 血,锦囊进弃牌堆', async () => {
    const state = buildState({
      p1Health: 2,
      p2Health: 1,
      p3Health: 3,
      playerCount: 3,
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('桃园结义', 'ty1');
    // 3 个目标(P1,P2,P3,含使用者)逐个询问无懈 → 各 pass
    await P1.pass();
    await P1.pass();
    await P1.pass();

    expect(harness.state.players[0].health).toBe(3); // 2 + 1
    expect(harness.state.players[1].health).toBe(2); // 1 + 1
    expect(harness.state.players[2].health).toBe(4); // 3 + 1
    expect(harness.state.zones.discardPile).toContain('ty1');
    expect(harness.state.zones.processing).not.toContain('ty1');
    // view 级断言:P1 视角 3 人各回 1 血
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].health).toBe(3);
      expect(v.players[1].health).toBe(2);
      expect(v.players[2].health).toBe(4);
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 满血不超 maxHealth
  // ─────────────────────────────────────────────────────────────
  it('P1/P2 满血(4/4) → 使用后仍为 4 血,不超 maxHealth', async () => {
    const state = buildState({ p1Health: 4, p2Health: 4 });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('桃园结义', 'ty1');
    // P1/P2 均满血 → 桃园结义对其无效果,不询问无懈可击(useCard 内 waitForStable 即结算完成)

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(4);
    // view 级断言:满血不超 maxHealth
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].health).toBe(4);
      expect(v.players[1].health).toBe(4);
      expect(v.pending).toBeNull();
    });
    // state 级:满血目标不问询无懈 → useCard 后无 pending
    P1.expectNoPending();
  });

  // ─────────────────────────────────────────────────────────────
  // 2b. 满血目标不问询无懈可击(桃园结义对其无效果,无可抵消的效果)
  // ─────────────────────────────────────────────────────────────
  it('满血目标不问询无懈 → 仅未满血目标产生无懈窗口', async () => {
    // P1 满血(4/4)、P2 未满血(2/4)、P3 未满血(3/4)
    const state = buildState({ p1Health: 4, p2Health: 2, p3Health: 3, playerCount: 3 });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('桃园结义', 'ty1');
    // P1 满血 → 不问询无懈;按座次首个窗口是 P2 的无懈(而非 P1 的)
    P1.expectPending('请求回应');
    await P1.pass();
    // P3 未满血 → 第二个无懈窗口(P1 满血无窗口)
    P1.expectPending('请求回应');
    await P1.pass();

    // P1 满血不回血;P2/P3 各 +1
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[2].health).toBe(4);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. validate 拒绝:非出牌阶段
  // ─────────────────────────────────────────────────────────────
  it('非出牌阶段(准备阶段)使用 → 被拒绝', async () => {
    await harness.setup(buildState({ phase: '准备' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '桃园结义',
      actionType: 'use',
      params: { cardId: 'ty1' },
    });
  });

  it('非出牌阶段(弃牌阶段)使用 → 被拒绝', async () => {
    await harness.setup(buildState({ phase: '弃牌' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '桃园结义',
      actionType: 'use',
      params: { cardId: 'ty1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:pending 期间
  // ─────────────────────────────────────────────────────────────
  it('pending 期间使用 → 被拒绝(防死锁)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const dodge = makeCard('d1', '闪', '♥', '5', '基本牌');
    const state = buildState({
      p1Hand: ['ty1', 's1'],
      extraCards: { s1: slash, d1: dodge },
    });
    state.players[0].skills = ['桃园结义', '杀'];
    state.players[1].skills = ['闪'];
    state.players[1].hand = ['d1'];
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P1.expectRejected({
      skillId: '桃园结义',
      actionType: 'use',
      params: { cardId: 'ty1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:牌不在手
  // ─────────────────────────────────────────────────────────────
  it('出不在手牌的桃园结义 → 被拒绝', async () => {
    await harness.setup(buildState({ p1Hand: [] }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '桃园结义',
      actionType: 'use',
      params: { cardId: 'ty1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. validate 拒绝:非自己回合
  // ─────────────────────────────────────────────────────────────
  it('非自己回合使用 → 被拒绝', async () => {
    await harness.setup(buildState());
    const P2 = harness.player('P2');
    await P2.expectRejected({
      skillId: '桃园结义',
      actionType: 'use',
      params: { cardId: 'ty1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. validate 拒绝:牌名错
  // ─────────────────────────────────────────────────────────────
  it('用杀当桃园结义出 → 被拒绝(cardNameOk=false)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p1Hand: ['s1'],
      extraCards: { s1: slash },
    });
    state.players[0].skills = ['桃园结义', '杀'];
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '桃园结义',
      actionType: 'use',
      params: { cardId: 's1' },
    });
  });
});
