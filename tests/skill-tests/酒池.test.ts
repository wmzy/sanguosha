// 酒池(董卓·转化技)技能测试:
//   你可以将一张黑桃手牌当【酒】使用。
//
// 验证:
//   1. 正面:黑桃(♠)手牌 transformThenUse 酒 → 创建影子酒 + 酒生效(增伤标记)
//   2. 负面:非黑桃(♥)牌 transform 被拒
//   3. 负面:非自己回合 transform 被拒
//   4. 负面:不在手牌的卡 transform 被拒
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '董卓',
    health: opts.health ?? 5,
    maxHealth: opts.maxHealth ?? 8,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['酒池', '酒'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function buildState(opts: {
  p0Hand?: string[];
  cards?: Record<string, Card>;
  currentPlayerIndex?: number;
}): GameState {
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P0', hand: opts.p0Hand ?? ['c1'] }),
      makePlayer({ index: 1, name: 'P1', hand: [] }),
    ],
    cardMap: opts.cards ?? {},
    currentPlayerIndex: opts.currentPlayerIndex ?? 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('酒池', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:黑桃当酒使用 ─────────────────────────────────

  it('黑桃手牌 transformThenUse 酒 → 影子酒建立 + 增伤标记生效', async () => {
    const spade = makeCard('c1', '杀', '♠', '7'); // 黑桃杀(非酒)
    const state = buildState({ p0Hand: ['c1'], cards: { c1: spade } });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.transformThenUse('酒池', { cardId: 'c1' }, '酒', { cardId: 'c1#酒池' });

    // 影子酒入弃牌堆时还原为原卡(移动牌 atom 对 shadowOf 的处理),
    // 故弃牌堆含原黑桃牌 id,影子卡已从 cardMap 删除
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c1');
    // 酒生效:增伤标记已加到董卓(证明影子酒被当作真酒使用成功)
    expect(
      harness.state.players[0].marks.some((m) => m.id === '酒/nextKillDamageBonus'),
    ).toBe(true);
  });

  // ─── 负面:非黑桃牌被拒 ─────────────────────────────────

  it('红桃牌 transform 被拒(不是黑桃)', async () => {
    const heart = makeCard('c1', '杀', '♥', '7'); // 红桃
    const state = buildState({ p0Hand: ['c1'], cards: { c1: heart } });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '酒池',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });
    // 牌仍在手
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── 负面:梅花牌被拒(黑桃专属,黑色不算) ───────────────

  it('梅花牌 transform 被拒(仅黑桃,非黑色)', async () => {
    const club = makeCard('c1', '杀', '♣', '7'); // 梅花(黑色但非黑桃)
    const state = buildState({ p0Hand: ['c1'], cards: { c1: club } });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '酒池',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });
  });

  // ─── 负面:非自己回合被拒 ─────────────────────────────────

  it('非自己回合 transform 被拒', async () => {
    const spade = makeCard('c1', '杀', '♠', '7');
    const state = buildState({
      p0Hand: ['c1'],
      cards: { c1: spade },
      currentPlayerIndex: 1, // P1 回合
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '酒池',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });
  });

  // ─── 负面:不在手牌的卡被拒 ───────────────────────────────

  it('不在手牌的卡 transform 被拒', async () => {
    const spade = makeCard('c1', '杀', '♠', '7');
    const state = buildState({ p0Hand: [], cards: { c1: spade } });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '酒池',
      actionType: 'transform',
      params: { cardId: 'c1' },
    });
  });
});
