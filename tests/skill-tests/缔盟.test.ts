// 缔盟(鲁肃·吴·主动技)测试
//   出牌阶段，你可以选择两名其他角色，
//   弃置等同于这两名角色手牌数差的牌，然后交换他们的手牌。每回合限一次。
//
// 验证:
//   1. diff > 0:鲁肃弃 diff 张,交换两人手牌
//   2. diff = 0:无需弃牌,直接交换
//   3. 每回合限一次:第二次发动被拒绝
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
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '鲁肃',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: '吴',
    identity: '主公',
  };
}

describe('缔盟', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. diff > 0:弃牌 + 交换 ──────────────────────────────
  it('P1(3张) vs P2(1张),diff=2:鲁肃弃2张,交换手牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          hand: ['c1', 'c2', 'c3', 'c4', 'c5'],
          skills: ['缔盟'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a', 'p1b', 'p1c'],
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['p2a'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        c3: makeCard('c3', '桃', '♦'),
        c4: makeCard('c4', '酒', '♣'),
        c5: makeCard('c5', '杀', '♠'),
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        p1c: makeCard('p1c', '桃', '♥'),
        p2a: makeCard('p2a', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('鲁肃');

    // 发动缔盟
    await P0.triggerAction('缔盟', 'use');
    P0.expectPending('请求回应'); // 选目标

    // 选 P1 和 P2
    await P0.respond('缔盟', { targets: [1, 2] });
    P0.expectPending('请求回应'); // 弃牌(diff=2)

    // 弃 2 张牌
    await P0.respond('缔盟', { cardIds: ['c1', 'c2'] });

    // 鲁肃:5 - 2(弃) = 3 张
    expect(harness.state.players[0].hand.length).toBe(3);
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[0].hand).not.toContain('c2');
    // 弃牌堆含 c1, c2
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'c2']));

    // P1 原手牌 [p1a,p1b,p1c] → 交换后应等于 P2 原手牌 [p2a]
    expect(harness.state.players[1].hand).toEqual(['p2a']);
    // P2 原手牌 [p2a] → 交换后应等于 P1 原手牌 [p1a,p1b,p1c]
    expect(harness.state.players[2].hand).toEqual(['p1a', 'p1b', 'p1c']);
  });

  // ─── 2. diff = 0:无需弃牌,直接交换 ───────────────────────
  it('P1(2张) vs P2(2张),diff=0:无需弃牌,直接交换', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          hand: ['c1', 'c2'],
          skills: ['缔盟'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a', 'p1b'],
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['p2a', 'p2b'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        p1a: makeCard('p1a', '杀'),
        p1b: makeCard('p1b', '闪'),
        p2a: makeCard('p2a', '桃', '♥'),
        p2b: makeCard('p2b', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('鲁肃');

    // 发动缔盟
    await P0.triggerAction('缔盟', 'use');
    P0.expectPending('请求回应'); // 选目标

    // 选 P1 和 P2
    await P0.respond('缔盟', { targets: [1, 2] });

    // diff=0,无需弃牌 → 直接交换完成
    // 鲁肃手牌不变
    expect(harness.state.players[0].hand.length).toBe(2);

    // P1 原手牌 [p1a,p1b] → 交换后 = P2 原手牌 [p2a,p2b]
    expect(harness.state.players[1].hand).toEqual(['p2a', 'p2b']);
    // P2 原手牌 [p2a,p2b] → 交换后 = P1 原手牌 [p1a,p1b]
    expect(harness.state.players[2].hand).toEqual(['p1a', 'p1b']);
  });

  // ─── 3. 每回合限一次 ──────────────────────────────────────
  it('每回合限一次:第二次发动被拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          hand: ['c1', 'c2', 'c3', 'c4'],
          skills: ['缔盟'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a'],
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['p2a'],
          skills: [],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀'),
        c2: makeCard('c2', '闪'),
        c3: makeCard('c3', '桃', '♦'),
        c4: makeCard('c4', '酒', '♣'),
        p1a: makeCard('p1a', '杀'),
        p2a: makeCard('p2a', '闪'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('鲁肃');

    // 第一次:发动缔盟(P1,P2 均 1 张,diff=0,无需弃牌)
    await P0.triggerAction('缔盟', 'use');
    P0.expectPending('请求回应');
    await P0.respond('缔盟', { targets: [1, 2] });
    // 第一次完成
    expect(harness.state.players[0].vars['缔盟/usedThisTurn']).toBe(true);

    // 第二次:应被拒绝(validate 返回错误)
    await P0.expectRejected({
      skillId: '缔盟',
      actionType: 'use',
      params: {},
    });
  });
});
