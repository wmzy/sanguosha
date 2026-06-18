// tests/skill-tests/顺手牵羊.test.ts
// 顺手牵羊(普通锦囊):出牌阶段对距离 1 内其他角色使用,获得其一张手牌。
// (本测试覆盖手牌;装备获得路径同源,未单独测。)
//
// 覆盖:
//   1. 拿目标手牌:目标失去第一张手牌,发起者手牌 +1,锦囊进弃牌堆
//   2. 距离 <= 1 校验:距离 > 1 时被 validate 拒绝
//   3. validate 拒绝(negative):非自己回合 / pending 期间 / 目标无手牌 / 牌不在手 / 目标是自己
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
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
    skills: opts.skills ?? ['顺手牵羊', '杀'],
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
  playerCount?: number;
  p1Skills?: string[];
  p2Skills?: string[];
  extraCards?: Record<string, Card>;
}): GameState {
  const sq = makeCard('sq1', '顺手牵羊', '♠', '4');
  const cards: Record<string, Card> = { sq1: sq, ...(opts?.extraCards ?? {}) };
  const n = opts?.playerCount ?? 2;
  const players = [
    makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? ['sq1'], skills: opts?.p1Skills ?? ['顺手牵羊', '杀'] }),
    makePlayer({ index: 1, name: 'P2', hand: opts?.p2Hand ?? [], skills: opts?.p2Skills ?? ['杀'] }),
  ];
  for (let i = 2; i < n; i++) {
    players.push(makePlayer({ index: i, name: `P${i + 1}`, skills: [] }));
  }
  return createGameState({
    players,
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('顺手牵羊', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 正面效果:拿目标手牌
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P2(距离 1)出顺手牵羊 → 拿到 P2 第一张手牌', async () => {
    const victimCard = makeCard('v1', '杀', '♥', '5', '基本牌');
    const state = buildState({
      p2Hand: ['v1', 'v2'],
      extraCards: { v1: victimCard, v2: makeCard('v2', '闪', '♦', '6', '基本牌') },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    // P1 起手手牌 = 1 (sq1),用出后从 P2 拿到 v1,手牌数仍为 1

    // 顺手牵羊 的 validate 使用 params.target(单数),不是 targets
    await P1.triggerAction('顺手牵羊', 'use', { cardId: 'sq1', target: 1 });
    await P1.pass(); // 消耗无懈窗口

    // P2 失去 v1
    expect(harness.state.players[1].hand).not.toContain('v1');
    // P1 拿到 v1
    expect(harness.state.players[0].hand).toContain('v1');
    expect(harness.state.players[0].hand.length).toBe(1);
    // 锦囊进弃牌堆
    expect(harness.state.zones.discardPile).toContain('sq1');
    expect(harness.state.zones.processing).not.toContain('sq1');
  });

  // ─────────────────────────────────────────────────────────────
  // 2. validate 拒绝:距离 > 1
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P3(距离 2)出顺手牵羊 → 被拒绝(距离 > 1)', async () => {
    // 3 个存活玩家,P1 (idx 0) → P3 (idx 2):座位距离 = 2
    await harness.setup(buildState({ playerCount: 3 }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 2 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. validate 拒绝:非自己回合
  // ─────────────────────────────────────────────────────────────
  it('非自己回合出顺手牵羊 → 被拒绝', async () => {
    await harness.setup(buildState({ p2Hand: ['v1'] }));
    const P2 = harness.player('P2');
    await P2.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 0 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:pending 期间
  // ─────────────────────────────────────────────────────────────
  it('pending 期间出顺手牵羊 → 被拒绝(防死锁)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p1Hand: ['sq1', 's1'],
      p2Hand: [],
      p2Skills: ['闪'],
      extraCards: { s1: slash },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.useCardAndTarget('杀', 's1', [1]);
    // pending 期间再出顺手牵羊应被拒
    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:目标无手牌
  // ─────────────────────────────────────────────────────────────
  it('目标无手牌 → 被拒绝(targetHasHand=false)', async () => {
    await harness.setup(buildState({ p2Hand: [] }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. validate 拒绝:牌名不是顺手牵羊
  // ─────────────────────────────────────────────────────────────
  it('用错的牌名(杀)出顺手牵羊 → 被拒绝(cardNameOk=false)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p1Hand: ['s1'],
      p2Hand: ['v1'],
      extraCards: { s1: slash, v1: makeCard('v1', '杀', '♥', '5', '基本牌') },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 's1', target: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. validate 拒绝:目标是自己
  // ─────────────────────────────────────────────────────────────
  it('对自己出顺手牵羊 → 被拒绝(notSelf)', async () => {
    await harness.setup(buildState({ p2Hand: ['v1'] }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '顺手牵羊',
      actionType: 'use',
      params: { cardId: 'sq1', target: 0 },
    });
  });
});
