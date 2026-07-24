// 火攻(普通锦囊)技能测试:
//   use:出牌阶段对一名有手牌的其他角色使用。
//   流程:目标展示一张手牌 → 使用者弃一张同花色手牌 → 造成1点火焰伤害。
//
// 验证:
//   1. 正面:目标展示♥ → 使用者弃♥ → 目标扣1血(火焰伤害 damageType='火焰')
//   2. 正面:目标展示♥ → 使用者弃♦(不同花色)被拒;使用者pass(不弃)→ 无伤害
//   3. 正面:使用者无同花色手牌 → 不询问弃牌 → 无伤害
//   4. 正面:无懈可击抵消 → 无展示/无伤害
//   5. 负面:目标无手牌 → 拒绝
//   6. 负面:对自己使用 → 拒绝
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
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['火攻'],
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
  extraCards?: Record<string, Card>;
}): GameState {
  const cards: Record<string, Card> = { ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? [] }),
      makePlayer({ index: 1, name: 'P2', hand: opts?.p2Hand ?? [] }),
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('火攻', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:展示♥ → 弃♥ → 火焰伤害 ─────────────────────────────
  it('P1 火攻 P2 → pass 无懈 → P2 展示♥ → P1 弃♥ → P2 扣1血(火焰伤害)', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const match = makeCard('m1', '桃', '♥', '5'); // P1 用来弃的♥
    const reveal = makeCard('r1', '杀', '♥', '3'); // P2 展示的♥
    const state = buildState({
      p1Hand: ['hg', 'm1'],
      p2Hand: ['r1'],
      extraCards: { hg, m1: match, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('火攻', 'hg', [1]);
    // 无懈可击窗口 → pass
    P1.expectPending('请求回应');
    await P1.pass();

    // P2 被询问展示一张手牌(火攻/展示)
    P2.expectPending('请求回应');
    const info2 = P2.respondInfo();
    expect(info2?.skillId).toBe('火攻');
    await P2.respond('火攻', { cardId: 'r1' });

    // P1 被询问弃一张同花色(♥)手牌(火攻/弃牌)
    P1.expectPending('请求回应');
    const info1 = P1.respondInfo();
    expect(info1?.skillId).toBe('火攻');
    // 仅♥牌可弃
    expect(P1.respondableCards().map((c) => c.id)).toEqual(['m1']);
    await P1.respond('火攻', { cardId: 'm1' });

    // P2 扣 1 血
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 火攻牌 + 弃牌进弃牌堆;展示牌仍在 P2 手牌
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['hg', 'm1']));
    expect(harness.state.players[1].hand).toContain('r1');
    expect(harness.state.zones.processing).toEqual([]);

    // 验证造成的是火焰伤害
    const damageEvents = harness.state.atomHistory.filter(
      (e): e is typeof e & { kind: 'atom'; atom: Record<string, unknown> } =>
        e.kind === 'atom' && (e.atom as Record<string, unknown>).type === '受到伤害时',
    );
    const lastDamage = damageEvents[damageEvents.length - 1].atom;
    expect(lastDamage.damageType).toBe('火焰');

    // view 级断言
    P2.processEvents();
    P2.expectView((v) => expect(v.players[1].health).toBe(p2HealthBefore - 1));
  });

  // ─── 2. 正面:使用者不弃(pass)→ 无伤害 ───────────────────────────
  it('P1 火攻 P2 → P2 展示♥ → P1 pass(不弃)→ 无伤害', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const match = makeCard('m1', '桃', '♥', '5');
    const reveal = makeCard('r1', '杀', '♥', '3');
    const state = buildState({
      p1Hand: ['hg', 'm1'],
      p2Hand: ['r1'],
      extraCards: { hg, m1: match, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('火攻', 'hg', [1]);
    await P1.pass(); // 无懈
    P2.expectPending('请求回应');
    await P2.respond('火攻', { cardId: 'r1' }); // 展示♥
    P1.expectPending('请求回应'); // 火攻/弃牌
    await P1.pass(); // 不弃

    // 无伤害
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
    // 火攻牌进弃牌堆;m1 仍在 P1 手牌
    expect(harness.state.zones.discardPile).toContain('hg');
    expect(harness.state.players[0].hand).toContain('m1');
  });

  // ─── 3. 正面:使用者无同花色手牌 → 不询问弃牌 → 无伤害 ─────────────
  it('P1 火攻 P2 → P2 展示♥ → P1 无♥手牌 → 无弃牌窗口 → 无伤害', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const other = makeCard('o1', '杀', '♠', '5'); // P1 只有黑牌
    const reveal = makeCard('r1', '杀', '♥', '3');
    const state = buildState({
      p1Hand: ['hg', 'o1'],
      p2Hand: ['r1'],
      extraCards: { hg, o1: other, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('火攻', 'hg', [1]);
    await P1.pass(); // 无懈
    P2.expectPending('请求回应');
    await P2.respond('火攻', { cardId: 'r1' }); // 展示♥

    // P1 无♥ → 不询问弃牌,直接结束(无 pending)
    P1.expectNoPending();
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
    expect(harness.state.zones.discardPile).toContain('hg');
  });

  // ─── 4. 正面:弃牌窗口拒绝不同花色 ────────────────────────────────
  it('P1 火攻 P2 → P2 展示♥ → P1 试图弃♦(不同花色)被拒', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const heart = makeCard('h1', '桃', '♥', '5');
    const diamond = makeCard('d1', '桃', '♦', '7'); // ♦ 不同花色
    const reveal = makeCard('r1', '杀', '♥', '3');
    const state = buildState({
      p1Hand: ['hg', 'h1', 'd1'],
      p2Hand: ['r1'],
      extraCards: { hg, h1: heart, d1: diamond, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('火攻', 'hg', [1]);
    await P1.pass(); // 无懈
    P2.expectPending('请求回应');
    await P2.respond('火攻', { cardId: 'r1' }); // 展示♥

    P1.expectPending('请求回应'); // 火攻/弃牌,仅♥可弃
    // 试图弃♦被拒
    await P1.expectRejected({ skillId: '火攻', actionType: 'respond', params: { cardId: 'd1' } });
    // 正确弃♥
    await P1.respond('火攻', { cardId: 'h1' });
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 5. 负面:目标无手牌 → 拒绝 ────────────────────────────────────
  it('目标无手牌 → 火攻被拒', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const state = buildState({
      p1Hand: ['hg'],
      p2Hand: [],
      extraCards: { hg },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '火攻',
      actionType: 'use',
      params: { cardId: 'hg', targets: [1] },
    });
  });

  // ─── 6. 负面:对自己使用 → 拒绝 ────────────────────────────────────
  it('对自己使用火攻 → 被拒', async () => {
    const hg = makeCard('hg', '火攻', '♥', '2');
    const other = makeCard('o1', '杀', '♥', '5');
    const state = buildState({
      p1Hand: ['hg', 'o1'],
      p2Hand: ['r1'],
      extraCards: { hg, o1: other, r1: makeCard('r1', '杀', '♥', '3') },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '火攻',
      actionType: 'use',
      params: { cardId: 'hg', targets: [0] },
    });
  });
});
