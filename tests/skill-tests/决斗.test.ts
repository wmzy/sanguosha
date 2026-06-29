// tests/skill-tests/决斗.test.ts
// 决斗(普通锦囊):出牌阶段对一名其他角色使用,目标先出杀,之后发起者出杀,轮流;
// 首先不出杀的一方受到对方造成的 1 点伤害。
//
// 完整行为测试覆盖:
//   正面:
//     1. P2 出杀 → P1 出杀 → P2 再被询问 → pass → P2 扣 1 血
//        每步都用 expectPending + respondInfo 验证窗口(cardFilter)
//   负面(expectRejected):
//     - 非自己回合 / pending 期间 / 目标是自己 / 牌名错 / 牌不在手
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
    skills: opts.skills ?? ['杀'],
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
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function buildState(opts?: {
  p1Hand?: string[];
  p2Hand?: string[];
  p1Skills?: string[];
  p2Skills?: string[];
  extraCards?: Record<string, Card>;
}): GameState {
  const duel = makeCard('jd1', '决斗', '♠', 'A');
  const cards: Record<string, Card> = { jd1: duel, ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        hand: opts?.p1Hand ?? ['jd1'],
        skills: opts?.p1Skills ?? ['杀', '决斗'],
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        hand: opts?.p2Hand ?? [],
        skills: opts?.p2Skills ?? ['杀'],
      }),
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('决斗', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. 正面:轮转后 P2 耗尽杀 → P2 扣 1 血
  //    全程用 expectPending + respondInfo 验证 pending + cardFilter
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P2 出决斗 → expectPending(请求回应)无懈 → pass → expectPending(询问杀)P2 → respond 出杀 → expectPending(询问杀)P1 → respond 出杀 → expectPending(询问杀)P2 → pass → P2 扣血', async () => {
    const s1 = makeCard('p1s', '杀', '♠', '5', '基本牌');
    const s2 = makeCard('p2s', '杀', '♥', '6', '基本牌');
    const state = buildState({
      p1Hand: ['jd1', 'p1s'],
      p2Hand: ['p2s'],
      p2Skills: ['杀', '无懈可击'], // 加 无懈可击 让 P2 respondInfo 能推导 cardFilter
      extraCards: { p1s: s1, p2s: s2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    // 出决斗(params 用 targets 数组,前端统一格式)
    await P1.triggerAction('决斗', 'use', { cardId: 'jd1', targets: [1] });

    // 窗口 1:无懈可击(broadcast target=-2)→ P2 视角推导 skillId=无懈可击 + cardFilter
    P1.expectPending('请求回应');
    const info1 = P2.respondInfo();
    expect(info1?.skillId).toBe('无懈可击');
    expect(info1?.cardFilter).toBeDefined();
    // P2 手中 [p2s] 但无懈可击 cardFilter 只接受 无懈可击 → 空
    expect(P2.respondableCards()).toEqual([]);
    await P1.pass(); // 消耗无懈窗口

    // 窗口 2:P2 被询问出杀(询问杀,target=P2)
    P2.expectPending('询问杀');
    const info2 = P2.respondInfo();
    expect(info2?.skillId).toBe('杀'); // '询问杀' → skillId='杀'
    expect(info2?.cardFilter).toBeDefined();
    // P2 手中 [p2s] → respondableCards 仅包含 p2s
    expect(P2.respondableCards().map((c) => c.id)).toEqual(['p2s']);
    await P2.respond('杀', { cardId: 'p2s' });

    // 窗口 3:轮转 → P1 被询问出杀
    P1.expectPending('询问杀');
    const info3 = P1.respondInfo();
    expect(info3?.skillId).toBe('杀');
    // P1 手中 [p1s] → 可出
    expect(P1.respondableCards().map((c) => c.id)).toEqual(['p1s']);
    await P1.respond('杀', { cardId: 'p1s' });

    // 窗口 4:再轮转 → P2 被询问(手中已无杀)
    P2.expectPending('询问杀');
    const info4 = P2.respondInfo();
    expect(info4?.skillId).toBe('杀');
    // P2 手中无牌 → respondableCards 空
    expect(P2.respondableCards()).toEqual([]);
    await P2.pass();

    // P2 扣 1 血
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 所有牌进弃牌堆
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['jd1', 'p1s', 'p2s']));
    expect(harness.state.zones.processing).toEqual([]);
    // view 级断言
    P2.processEvents();
    P2.expectView((v) => {
      expect(v.players[1].health).toBe(p2HealthBefore - 1);
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 正面:目标立即不出杀 → 目标扣 1 血
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P2 出决斗 → pass 无懈 → P2 expectPending(询问杀) → pass → P2 扣 1 血', async () => {
    const state = buildState({
      p1Hand: ['jd1'],
      p2Hand: [],
      p2Skills: ['杀'],
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.triggerAction('决斗', 'use', { cardId: 'jd1', targets: [1] });
    await P1.pass(); // 消耗无懈窗口

    P2.expectPending('询问杀');
    const info = P2.respondInfo();
    expect(info?.skillId).toBe('杀');
    expect(info?.cardFilter).toBeDefined();
    // P2 无手牌 → respondableCards 空
    expect(P2.respondableCards()).toEqual([]);
    await P2.pass();

    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    expect(harness.state.zones.discardPile).toContain('jd1');
    // view 级断言
    P2.processEvents();
    P2.expectView((v) => {
      expect(v.players[1].health).toBe(p2HealthBefore - 1);
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. validate 拒绝:非自己回合
  // ─────────────────────────────────────────────────────────────
  it('非自己回合出决斗 → 被拒绝', async () => {
    await harness.setup(buildState({ p1Skills: ['杀', '决斗'] }));
    const P2 = harness.player('P2');
    await P2.expectRejected({
      skillId: '决斗',
      actionType: 'use',
      params: { cardId: 'jd1', targets: [0] },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:pending 期间
  // ─────────────────────────────────────────────────────────────
  it('pending 期间出决斗 → 被拒绝(防死锁)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const dodge = makeCard('d1', '闪', '♥', '5', '基本牌');
    const state = buildState({
      p1Hand: ['jd1', 's1'],
      p2Hand: ['d1'],
      p1Skills: ['杀', '决斗'],
      p2Skills: ['闪'],
      extraCards: { s1: slash, d1: dodge },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P1.expectRejected({
      skillId: '决斗',
      actionType: 'use',
      params: { cardId: 'jd1', targets: [1] },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:目标是自己
  // ─────────────────────────────────────────────────────────────
  it('对自己出决斗 → 被拒绝(不能指定自己)', async () => {
    await harness.setup(buildState({ p1Skills: ['杀', '决斗'] }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '决斗',
      actionType: 'use',
      params: { cardId: 'jd1', targets: [0] },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. validate 拒绝:牌名不是决斗
  // ─────────────────────────────────────────────────────────────
  it('用杀当决斗出 → 被拒绝(cardNameOk=false)', async () => {
    const slash = makeCard('s1', '杀', '♠', '7', '基本牌');
    const state = buildState({
      p1Hand: ['s1'],
      p1Skills: ['杀', '决斗'],
      extraCards: { s1: slash },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '决斗',
      actionType: 'use',
      params: { cardId: 's1', targets: [1] },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. validate 拒绝:牌不在手
  // ─────────────────────────────────────────────────────────────
  it('出不在手牌的决斗 → 被拒绝', async () => {
    const state = buildState({ p1Hand: [] });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '决斗',
      actionType: 'use',
      params: { cardId: 'jd1', targets: [1] },
    });
  });
});
