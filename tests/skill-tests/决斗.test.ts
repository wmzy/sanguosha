// tests/skill-tests/决斗.test.ts
// 决斗(普通锦囊):出牌阶段对一名其他角色使用,目标先出杀,之后发起者出杀,轮流;
// 首先不出杀的一方受到对方造成的 1 点伤害。
//
// 覆盖:
//   1. 目标先出杀,发起者后出杀(双方各 1 张杀)→ 双方都不扣血,杀/决斗进弃牌堆
//   2. 目标不出杀(超时)→ 目标扣 1 血
//   3. validate 拒绝(negative):非自己回合 / pending 期间 / 牌不在手 / 目标是自己 / 牌名错
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
    skills: opts.skills ?? ['杀'],
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
  p1Skills?: string[];
  p2Skills?: string[];
  extraCards?: Record<string, Card>;
}): GameState {
  const duel = makeCard('jd1', '决斗', '♠', 'A');
  const cards: Record<string, Card> = { jd1: duel, ...(opts?.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: opts?.p1Hand ?? ['jd1'], skills: opts?.p1Skills ?? ['杀'] }),
      makePlayer({ index: 1, name: 'P2', hand: opts?.p2Hand ?? [], skills: opts?.p2Skills ?? ['杀'] }),
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
  // 1. 双方轮流出杀,1 轮后都出 → 都不扣血,所有牌进弃牌堆
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P2 出决斗 → 轮转后 P2 耗尽杀 → P2 扣 1 血,决斗牌进弃牌堆', async () => {
    // P1 出决斗 + 后手回应需要的杀;P2 只有 1 张杀
    const s1 = makeCard('p1s', '杀', '♠', '5', '基本牌');
    const s2 = makeCard('p2s', '杀', '♥', '6', '基本牌');
    const state = buildState({
      p1Hand: ['jd1', 'p1s'],
      p2Hand: ['p2s'],
      p1Skills: ['杀', '决斗'],
      p2Skills: ['杀'],
      extraCards: { p1s: s1, p2s: s2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    // 决斗需要 params.target(单数)
    await P1.triggerAction('决斗', 'use', { cardId: 'jd1', target: 1 });
    await P1.pass(); // 消耗无懈窗口

    // P2 出杀(出 p2s)
    await P2.respond('杀', { cardId: 'p2s' });
    // 轮转 → P1 出杀
    await P1.respond('杀', { cardId: 'p1s' });
    // 轮转又到 P2,P2 手中无杀 → pass()表示不出
    await P2.pass();

    // P2 输 → 扣 1 血
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 2 张杀 + 决斗牌都进弃牌堆
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['jd1', 'p1s', 'p2s']));
    expect(harness.state.zones.processing).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 目标不出杀(pass) → 目标扣 1 血
  // ─────────────────────────────────────────────────────────────
  it('P1 对 P2 出决斗,P2 不出杀 → P2 扣 1 血', async () => {
    // P2 没有手牌(没有杀)
    await harness.setup(buildState({
      p1Hand: ['jd1'],
      p2Hand: [],
      p1Skills: ['杀', '决斗'],
      p2Skills: ['杀'],
    }));
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.triggerAction('决斗', 'use', { cardId: 'jd1', target: 1 });
    await P1.pass(); // 消耗无懈窗口

    // P2 不出杀 → 输
    await P2.pass();

    // P2 扣 1 血
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 决斗进弃牌堆
    expect(harness.state.zones.discardPile).toContain('jd1');
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
      params: { cardId: 'jd1', target: 0 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. validate 拒绝:pending 期间
  // ─────────────────────────────────────────────────────────────
  it('pending 期间出决斗 → 被拒绝(防死锁)', async () => {
    // 先用出杀建 pending
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
    // pending 期间(询问闪)再出决斗应被拒
    await P1.expectRejected({
      skillId: '决斗',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. validate 拒绝:目标是自己
  // ─────────────────────────────────────────────────────────────
  it('对自己出决斗 → 被拒绝(targetNotSelf)', async () => {
    await harness.setup(buildState({ p1Skills: ['杀', '决斗'] }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '决斗',
      actionType: 'use',
      params: { cardId: 'jd1', target: 0 },
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
      params: { cardId: 's1', target: 1 },
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. validate 拒绝:牌不在手牌
  // ─────────────────────────────────────────────────────────────
  it('出不在手牌的决斗 → 被拒绝', async () => {
    // P1 没有 jd1
    const state = buildState({ p1Hand: [] });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '决斗',
      actionType: 'use',
      params: { cardId: 'jd1', target: 1 },
    });
  });
});
