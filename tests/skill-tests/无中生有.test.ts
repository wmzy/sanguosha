// tests/skill-tests/无中生有.test.ts
// 无中生有(普通锦囊):出牌阶段对自己使用,摸两张牌。
//
// 覆盖:
//   1. 摸2张效果:使用后手牌 +2(无中生有本身进弃牌堆)
//   2. validate 拒绝(negative):非出牌阶段 / pending 期间 / 牌不在手 / 牌名错
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState, TurnPhase } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  alive?: boolean;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['无中生有'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
  };
}

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌'): Card {
  return { id, name, suit, rank, type };
}

function buildState(opts?: {
  p1Hand?: string[];
  p2Hand?: string[];
  phase?: TurnPhase;
  extraCards?: Record<string, Card>;
}): GameState {
  const wz = makeCard('wz1', '无中生有', '♥', '7');
  const cards: Record<string, Card> = { wz1: wz, ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? ['wz1'] }),
      makePlayer({ index: 1, name: 'P2', skills: [] }),
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: opts?.phase ?? '出牌',
    turn: { round: 1, phase: opts?.phase ?? '出牌', vars: {} },
  });
}

describe('无中生有', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 正面效果:摸2张
  // ─────────────────────────────────────────────────────────────
  it('P1 在出牌阶段对自己使用无中生有 → 摸2张牌,锦囊进弃牌堆', async () => {
    // 准备牌堆:确保能摸到 2 张
    const c1 = makeCard('d1', '杀', '♠', '5', '基本牌');
    const c2 = makeCard('d2', '闪', '♥', '6', '基本牌');
    const state = buildState({ extraCards: { d1: c1, d2: c2 } });
    // 牌堆顶:d1, d2
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length; // 1 (wz1)

    await P1.useCard('无中生有', 'wz1');
    await P1.pass(); // 消耗无懈窗口

    // P1 起手 1 张 (wz1),用出后从牌堆摸 2 张 → 净 +1
    expect(harness.state.players[0].hand.length).toBe(handBefore + 1);
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['d1', 'd2']));
    // 无中生有本身进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wz1');
    expect(harness.state.zones.processing).not.toContain('wz1');
    // 牌堆少了 2 张
    expect(harness.state.zones.deck).not.toContain('d1');
    expect(harness.state.zones.deck).not.toContain('d2');
  });

  // ─────────────────────────────────────────────────────────────
  // 2. validate 拒绝:非出牌阶段
  // ─────────────────────────────────────────────────────────────
  it('非出牌阶段(准备阶段)使用无中生有 → 被拒绝', async () => {
    await harness.setup(buildState({ phase: '准备' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  it('非出牌阶段(弃牌阶段)使用无中生有 → 被拒绝', async () => {
    await harness.setup(buildState({ phase: '弃牌' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  it('非出牌阶段(结束阶段)使用无中生有 → 被拒绝', async () => {
    await harness.setup(buildState({ phase: '回合结束' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. validate 拒绝:pending 期间
  // ─────────────────────────────────────────────────────────────
  it('pending 期间使用无中生有 → 被拒绝(防死锁)', async () => {
    // 用出杀建 pending
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const dodge = makeCard('d1', '闪', '♥', '5', '基本牌');
    const state = buildState({
      p1Hand: ['wz1', 's1'],
      p2Hand: ['d1'],
      extraCards: { s1: slash, d1: dodge },
    });
    // P1 要出杀需要 杀 技能;P2 要回应需要 闪 技能
    state.players[0].skills = ['无中生有', '杀'];
    state.players[1].skills = ['闪'];
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.useCardAndTarget('杀', 's1', [1]);
    // pending 期间(询问闪)再出无中生有应被拒
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:牌不在手
  // ─────────────────────────────────────────────────────────────
  it('出不在手牌的无中生有 → 被拒绝', async () => {
    // P1 手牌里没有 wz1
    const state = buildState({ p1Hand: [] });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:非自己回合
  // ─────────────────────────────────────────────────────────────
  it('非自己回合使用无中生有 → 被拒绝', async () => {
    await harness.setup(buildState());
    const P2 = harness.player('P2');
    await P2.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 'wz1' },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. validate 拒绝:牌名不是无中生有
  // ─────────────────────────────────────────────────────────────
  it('用杀当无中生有出 → 被拒绝(cardNameOk=false)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p1Hand: ['s1'],
      extraCards: { s1: slash },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '无中生有',
      actionType: 'use',
      params: { cardId: 's1' },
    });
  });
});
