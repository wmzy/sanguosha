// 无双(吕布·锁定技)技能测试:
//   1. 你使用【杀】的目标需连续出两张【闪】才能抵消
//   2. 与你【决斗】的角色每次需连续打出两张【杀】
//
// 覆盖:
//   杀·正面:两张闪抵消 / 一张闪受伤 / 无闪受伤
//   杀·负面:非吕布出杀,一张闪即可抵消(无双不生效)
//   决斗·正面:吕布发起决斗,对方需双杀 / 吕布被决斗,发起者需双杀
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
  character?: string;
  hand?: string[];
  skills?: string[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '主公',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['杀'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

/** 构建杀测试 state:P1(吕布) 对 P2 出杀 */
function buildSlashState(opts: {
  p1Skills?: string[];
  p2Hand?: string[];
  extraCards?: Record<string, Card>;
}): GameState {
  const slash: Card = makeCard('c1', '杀', '♠', 'A');
  const cards: Record<string, Card> = { c1: slash, ...(opts.extraCards ?? {}) };
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        character: opts.p1Skills?.includes('无双') ? '吕布' : '主公',
        hand: ['c1'],
        skills: opts.p1Skills ?? ['杀', '无双'],
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        hand: opts.p2Hand ?? [],
        skills: ['闪'],
      }),
    ],
    cardMap: cards,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('无双', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 杀:目标需连续出两张闪
  // ─────────────────────────────────────────────────────────────

  it('吕布出杀 → 目标出两张闪 → 抵消,双方不扣血', async () => {
    const d1 = makeCard('d1', '闪', '♥', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const state = buildSlashState({
      p2Hand: ['d1', 'd2'],
      extraCards: { d1, d2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('杀', 'c1', [1]);

    // 第一轮询问闪
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });

    // 无双:第二轮询问闪
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd2' });

    // 两张闪都打出,杀被抵消
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'd1', 'd2']));
    expect(harness.state.zones.processing).toEqual([]);
  });

  it('吕布出杀 → 目标只有一张闪 → 第二轮 pass → 受伤', async () => {
    const d1 = makeCard('d1', '闪', '♥', '2');
    const state = buildSlashState({
      p2Hand: ['d1'],
      extraCards: { d1 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('杀', 'c1', [1]);

    // 第一轮:出闪
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });

    // 无双:第二轮询问闪 → 无闪可出 → pass
    P2.expectPending('询问闪');
    await P2.pass();

    // 只出了一张闪,未完全抵消 → 受伤
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'd1']));
    expect(harness.state.zones.processing).toEqual([]);
  });

  it('吕布出杀 → 目标无闪 → 直接受伤(无双不追加第二轮)', async () => {
    const state = buildSlashState({ p2Hand: [] });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('杀', 'c1', [1]);

    // 第一轮就 pass(无闪)
    P2.expectPending('询问闪');
    await P2.pass();

    // 受伤
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
  });

  // ─────────────────────────────────────────────────────────────
  // 杀·负面:非吕布出杀,一张闪即可抵消(无双不生效)
  // ─────────────────────────────────────────────────────────────

  it('非吕布出杀 → 一张闪即可抵消(无双不追加第二轮)', async () => {
    const d1 = makeCard('d1', '闪', '♥', '2');
    const d2 = makeCard('d2', '闪', '♥', '3');
    const state = buildSlashState({
      p1Skills: ['杀'], // 无无双
      p2Hand: ['d1', 'd2'],
      extraCards: { d1, d2 },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.useCardAndTarget('杀', 'c1', [1]);

    // 一张闪即抵消
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });

    // 不扣血,无双未触发(无第二轮询问)
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'd1']));
    expect(harness.state.zones.processing).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────
  // 决斗:吕布发起决斗 → 对方需连续打出两张杀
  // ─────────────────────────────────────────────────────────────

  it('吕布对 P2 出决斗 → P2 需双杀,只有一张 → P2 受伤', async () => {
    const jd1 = makeCard('jd1', '决斗', '♠', 'A', '锦囊牌');
    const p1s = makeCard('p1s', '杀', '♠', '5');
    const p2s = makeCard('p2s', '杀', '♥', '6');
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '吕布',
          hand: ['jd1', 'p1s'],
          skills: ['杀', '决斗', '无双'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['p2s'],
          skills: ['杀', '无懈可击'],
        }),
      ],
      cardMap: { jd1, p1s, p2s },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P1.triggerAction('决斗', 'use', { cardId: 'jd1', targets: [1] });

    // 无懈可击窗口
    await P1.pass();

    // 第一轮询问杀:P2 出杀
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 'p2s' });

    // 无双:第二轮询问杀:P2 无杀 → pass
    P2.expectPending('询问杀');
    await P2.pass();

    // P2 只出了一张杀,无双下不算 → P2 输 → 受伤
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['jd1', 'p2s']));
    expect(harness.state.zones.processing).toEqual([]);
  });

  it('吕布对 P2 出决斗 → P2 出两张杀 → 轮到吕布 → 吕布只需一张杀', async () => {
    const jd1 = makeCard('jd1', '决斗', '♠', 'A', '锦囊牌');
    const p1s = makeCard('p1s', '杀', '♠', '5');
    const p2s1 = makeCard('p2s1', '杀', '♥', '6');
    const p2s2 = makeCard('p2s2', '杀', '♥', '7');
    const p2s3 = makeCard('p2s3', '杀', '♥', '8');
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '吕布',
          hand: ['jd1', 'p1s'],
          skills: ['杀', '决斗', '无双'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['p2s1', 'p2s2', 'p2s3'],
          skills: ['杀', '无懈可击'],
        }),
      ],
      cardMap: { jd1, p1s, p2s1, p2s2, p2s3 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p1HealthBefore = harness.state.players[0].health;
    const p2HealthBefore = harness.state.players[1].health;

    await P1.triggerAction('决斗', 'use', { cardId: 'jd1', targets: [1] });
    await P1.pass(); // 无懈窗口

    // 第一轮:P2 出杀 #1
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 'p2s1' });

    // 无双:第二轮:P2 出杀 #2
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 'p2s2' });

    // 轮到吕布:P1 只需一张杀(无双不影响自己)
    P1.expectPending('询问杀');
    await P1.respond('杀', { cardId: 'p1s' });

    // 再轮到 P2:P2 需再出两张杀,只剩一张 → 受伤
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 'p2s3' });

    // 无双:第二轮 → P2 无杀 → pass
    P2.expectPending('询问杀');
    await P2.pass();

    // P2 输
    expect(harness.state.players[1].health).toBe(p2HealthBefore - 1);
    expect(harness.state.players[0].health).toBe(p1HealthBefore);
  });

  // ─────────────────────────────────────────────────────────────
  // 决斗:吕布被决斗 → 发起者需连续打出两张杀
  // ─────────────────────────────────────────────────────────────

  it('P2 对吕布出决斗 → 吕布出一张杀即可 → 轮到 P2 需双杀', async () => {
    const jd1 = makeCard('jd1', '决斗', '♠', 'A', '锦囊牌');
    const lbs = makeCard('lbs', '杀', '♠', '5');
    const p2s1 = makeCard('p2s1', '杀', '♥', '6');
    const p2s2 = makeCard('p2s2', '杀', '♥', '7');
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '吕布',
          hand: ['lbs'],
          skills: ['杀', '决斗', '无双'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['jd1', 'p2s1', 'p2s2'],
          skills: ['杀', '决斗', '无懈可击'],
        }),
      ],
      cardMap: { jd1, lbs, p2s1, p2s2 },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    const p2HealthBefore = harness.state.players[1].health;

    await P2.triggerAction('决斗', 'use', { cardId: 'jd1', targets: [0] });
    await P2.pass(); // 无懈窗口

    // 目标(吕布)先出杀:无双不影响自己,一张即可
    P1.expectPending('询问杀');
    await P1.respond('杀', { cardId: 'lbs' });

    // 轮到 P2(发起者):无双使 P2 需双杀
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 'p2s1' });

    // 无双:第二轮 → P2 出第二张杀
    P2.expectPending('询问杀');
    await P2.respond('杀', { cardId: 'p2s2' });

    // 再轮到吕布:无杀 → pass → 吕布输
    P1.expectPending('询问杀');
    await P1.pass();

    // 吕布输 → 受伤(P2 造成)
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[1].health).toBe(p2HealthBefore);
  });
});
