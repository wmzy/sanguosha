// 火计(卧龙诸葛·转化技)测试:
//   transform:把一张红色手牌当【火攻】(影子卡),配合 preceding + 火攻.use。
//
// 验证:
//   1. 正面:红♥牌 transformThenUse 火攻 → 创建影子火攻 → 完整火攻流程 → 火焰伤害
//   2. 正面:♦红牌 transform → 同样成功
//   3. rollback:transform + 火攻.use 失败(目标自己)→ 原卡还原,无影子
//   4. 负面:黑牌 transform 被拒(不是红色)
//   5. 负面:非自己回合 transform 被拒
//   6. availableActions:火计 transform action 声明,prompt 卡过滤是红牌
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
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '卧龙诸葛',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['火计'],
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
  current?: number;
}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        hand: opts?.p1Hand ?? [],
        skills: ['火计', '火攻', '闪'],
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        hand: opts?.p2Hand ?? [],
        skills: ['闪', '火攻'],
      }),
    ],
    cardMap: { ...(opts?.extraCards ?? {}) },
    currentPlayerIndex: opts?.current ?? 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('火计', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:红♥牌当火攻 → 完整流程 → 火焰伤害 ──────────────────
  it('transformThenUse:红♥牌当火攻 → 创建影子火攻 → P2 展示♥ → P1 弃♥ → 火焰伤害', async () => {
    const red = makeCard('c1', '桃', '♥', 'A'); // 转化为火攻的红牌
    const match = makeCard('m1', '杀', '♥', '5'); // P1 用来弃的♥
    const reveal = makeCard('r1', '闪', '♥', '3'); // P2 展示的♥
    const state = buildState({
      p1Hand: ['c1', 'm1'],
      p2Hand: ['r1'],
      extraCards: { c1: red, m1: match, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.transformThenUse('火计', { cardId: 'c1' }, '火攻', {
      cardId: 'c1#火计',
      targets: [1],
    });

    // 影子火攻已建立
    expect(harness.state.cardMap['c1#火计']).toBeDefined();
    expect(harness.state.cardMap['c1#火计'].name).toBe('火攻');
    expect(harness.state.cardMap['c1#火计'].shadowOf).toBe('c1');

    // 火攻完整流程:无懈 → 展示 → 弃牌 → 伤害
    await P1.pass(); // 无懈
    P2.expectPending('请求回应');
    await P2.respond('火攻', { cardId: 'r1' }); // 展示♥
    P1.expectPending('请求回应');
    await P1.respond('火攻', { cardId: 'm1' }); // 弃♥

    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    // 火焰伤害
    const damageEvents = harness.state.atomHistory.filter(
      (e): e is typeof e & { kind: 'atom'; atom: Record<string, unknown> } =>
        e.kind === 'atom' && (e.atom as Record<string, unknown>).type === '造成伤害',
    );
    expect(damageEvents[damageEvents.length - 1].atom.damageType).toBe('火焰');
    // 原卡 c1(转化源)最终进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  // ─── 2. 正面:♦红牌当火攻 ───────────────────────────────────────
  it('transformThenUse:♦红牌当火攻 → 创建影子火攻', async () => {
    const red = makeCard('d1', '桃', '♦', '5');
    const match = makeCard('m1', '杀', '♦', '7');
    const reveal = makeCard('r1', '闪', '♦', '3');
    const state = buildState({
      p1Hand: ['d1', 'm1'],
      p2Hand: ['r1'],
      extraCards: { d1: red, m1: match, r1: reveal },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.transformThenUse('火计', { cardId: 'd1' }, '火攻', {
      cardId: 'd1#火计',
      targets: [1],
    });
    expect(harness.state.cardMap['d1#火计'].name).toBe('火攻');
    await P1.pass();
    await P2.respond('火攻', { cardId: 'r1' });
    await P1.respond('火攻', { cardId: 'm1' });
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 3. rollback:transform + 火攻.use 失败 → 原卡还原 ────────────
  it('transform rollback:火攻.use 失败(目标自己)→ 原卡还原,无影子', async () => {
    const red = makeCard('c1', '桃', '♥', 'A');
    const state = buildState({
      p1Hand: ['c1'],
      extraCards: { c1: red },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 火攻.use 目标自己 → validate 拒绝 → rollback 火计 transform
    await P1.expectRejected({
      skillId: '火攻',
      actionType: 'use',
      params: {
        cardId: 'c1#火计',
        targets: [0],
        preceding: [{ skillId: '火计', actionType: 'transform', params: { cardId: 'c1' } }],
      },
    });

    expect(harness.state.cardMap['c1'].name).toBe('桃');
    expect(harness.state.cardMap['c1#火计']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['c1']);
  });

  // ─── 4. 负面:黑牌 transform 被拒 ────────────────────────────────
  it('transform:黑桃♠ → 拒绝(不是红色)', async () => {
    const black = makeCard('s1', '桃', '♠', 'A');
    const state = buildState({ p1Hand: ['s1'], extraCards: { s1: black } });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({ skillId: '火计', actionType: 'transform', params: { cardId: 's1' } });
  });

  // ─── 5. 负面:非自己回合 transform 被拒 ──────────────────────────
  it('transform:非自己回合 → 拒绝', async () => {
    const red = makeCard('c1', '桃', '♥', 'A');
    const state = buildState({
      p1Hand: ['c1'],
      extraCards: { c1: red },
      current: 1, // P2 回合
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    await P1.expectRejected({ skillId: '火计', actionType: 'transform', params: { cardId: 'c1' } });
  });

  // ─── 6. availableActions:火计 transform 声明,卡过滤是红牌 ────────
  it('availableActions:火计 transform 声明,prompt 卡过滤是红牌', async () => {
    const redHeart = makeCard('c1', '桃', '♥', 'A');
    const redDiamond = makeCard('c2', '桃', '♦', '2');
    const blackSpade = makeCard('c3', '杀', '♠', 'A');
    const state = buildState({
      p1Hand: ['c1', 'c2', 'c3'],
      extraCards: { c1: redHeart, c2: redDiamond, c3: blackSpade },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const actions = P1.availableActions();
    const huoji = actions.find((a) => a.skillId === '火计' && a.actionType === 'transform');
    expect(huoji).toBeDefined();
    expect(huoji!.label).toBe('火计');
    expect(huoji!.prompt.type).toBe('useCardAndTarget');

    const cardFilter =
      huoji!.prompt.type === 'useCardAndTarget' ? huoji!.prompt.cardFilter.filter : null;
    expect(cardFilter).toBeDefined();
    const allowed: string[] = [];
    for (const cardId of harness.state.players[0].hand) {
      const card = harness.state.cardMap[cardId];
      if (cardFilter!(card)) allowed.push(cardId);
    }
    expect(allowed).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(allowed).not.toContain('c3');
  });
});
