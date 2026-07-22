// 界黄天(界张角·主公技):其他群势力角色可在出牌阶段将一张【闪】或黑桃手牌交给你。
//   每名角色每回合限一次。
//
// 界限突破(相对标黄天):标版只能交【闪】或【闪电】;界版可交【闪】或任意黑桃手牌。
//
// 覆盖:
//   1. 群盟友交闪给界张角(主公) → 牌转移
//   2. 群盟友交黑桃杀(非闪电)给界张角 → 牌转移(界限突破新增)
//   3. 群盟友交红桃牌被拒(仅接受闪或黑桃)
//   4. 交梅花牌被拒(仅黑桃,非任意黑色)
//   5. 每回合限一次 → 第二次被拒
//   6. 非群势力 → 不可用
//   7. 界张角非主公 → 不可用
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
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
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  faction?: '魏' | '蜀' | '吴' | '群';
  hand?: string[];
  skills?: string[];
  health?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    faction: opts.faction,
  };
}

describe('界黄天', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 群盟友交闪给界张角(主公) ────────────────────────────
  it('群盟友出牌阶段交闪给界张角 → 牌转移到界张角手牌', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: [],
          skills: ['界黄天', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '群盟友',
          faction: '群',
          hand: ['d1'],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('群盟友');

    await P1.useCard('界黄天', 'd1');
    await waitForStable(harness.state);

    // 闪转移到界张角手牌
    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.players[1].hand).not.toContain('d1');
  });

  // ─── 2. 群盟友交黑桃杀(非闪电)→ 牌转移(界限突破新增) ────────
  it('群盟友交黑桃杀给界张角 → 牌转移(界限突破新增)', async () => {
    const spadeKill = makeCard('sk1', '杀', '♠', '7'); // ♠7 黑桃杀(非闪电)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: [],
          skills: ['界黄天', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '群盟友',
          faction: '群',
          hand: ['sk1'],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { sk1: spadeKill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('群盟友');

    await P1.useCard('界黄天', 'sk1');
    await waitForStable(harness.state);

    // ♠7 杀转移到界张角手牌
    expect(harness.state.players[0].hand).toContain('sk1');
    expect(harness.state.players[1].hand).not.toContain('sk1');
  });

  // ─── 3. 群盟友交红桃牌被拒(仅接受闪或黑桃) ──────────────────
  it('群盟友交红桃牌给界张角 → 被拒(界黄天只接受闪或黑桃)', async () => {
    const heartKill = makeCard('hk1', '杀', '♥', '7'); // ♥7 红桃杀 → 不接受
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: [],
          skills: ['界黄天', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '群盟友',
          faction: '群',
          hand: ['hk1'],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { hk1: heartKill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('群盟友');

    await P1.expectRejected({
      skillId: '界黄天',
      actionType: 'use',
      params: { cardId: 'hk1' },
    });

    // 牌未转移
    expect(harness.state.players[0].hand).not.toContain('hk1');
    expect(harness.state.players[1].hand).toContain('hk1');
  });

  // ─── 4. 群盟友交梅花牌被拒(仅黑桃,非任意黑色) ────────────────
  it('群盟友交梅花牌给界张角 → 被拒(界黄天只接受黑桃,不接受梅花)', async () => {
    const clubKill = makeCard('ck1', '杀', '♣', '7'); // ♣7 梅花(黑色但非黑桃) → 不接受
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: [],
          skills: ['界黄天', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '群盟友',
          faction: '群',
          hand: ['ck1'],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { ck1: clubKill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('群盟友');

    await P1.expectRejected({
      skillId: '界黄天',
      actionType: 'use',
      params: { cardId: 'ck1' },
    });

    // 牌未转移
    expect(harness.state.players[0].hand).not.toContain('ck1');
    expect(harness.state.players[1].hand).toContain('ck1');
  });

  // ─── 5. 每回合限一次 → 第二次被拒 ────────────────────────
  it('同一盟友每回合只能交一次 → 第二次被拒', async () => {
    const dodge1 = makeCard('d1', '闪', '♥', '2');
    const spadeKill = makeCard('sk1', '杀', '♠', '5'); // 第二张(黑桃)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: [],
          skills: ['界黄天', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '群盟友',
          faction: '群',
          hand: ['d1', 'sk1'],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge1, sk1: spadeKill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('群盟友');

    // 第一次:交闪 → 成功
    await P1.useCard('界黄天', 'd1');
    await waitForStable(harness.state);
    expect(harness.state.players[0].hand).toContain('d1');

    // 第二次:交黑桃杀 → 被拒(本回合已用)
    await P1.expectRejected({
      skillId: '界黄天',
      actionType: 'use',
      params: { cardId: 'sk1' },
    });
    expect(harness.state.players[0].hand).not.toContain('sk1');
    expect(harness.state.players[1].hand).toContain('sk1');
  });

  // ─── 6. 非群势力 → 不可用 ────────────────────────────────
  it('非群势力角色不能使用界黄天 → 被拒', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: [],
          skills: ['界黄天', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '魏将',
          faction: '魏', // 非群势力
          hand: ['d1'],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('魏将');

    await P1.expectRejected({
      skillId: '界黄天',
      actionType: 'use',
      params: { cardId: 'd1' },
    });

    // 牌未转移
    expect(harness.state.players[0].hand).not.toContain('d1');
    expect(harness.state.players[1].hand).toContain('d1');
  });

  // ─── 7. 界张角非主公 → 不可用 ──────────────────────────────
  it('界张角非主公(ownerId≠0)→ 界黄天不可用', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '其他主公',
          faction: '群',
          hand: [],
          skills: ['回合管理'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: '界张角',
          character: '界张角',
          faction: '群',
          hand: [],
          skills: ['界黄天', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 2,
          name: '群盟友',
          faction: '群',
          hand: ['d1'],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge },
      currentPlayerIndex: 2, // 群盟友回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P2 = harness.player('群盟友');

    // 界张角(ownerId=1)非主公 → 界黄天不可用
    await P2.expectRejected({
      skillId: '界黄天',
      actionType: 'use',
      params: { cardId: 'd1' },
    });

    // 牌未转移
    expect(harness.state.players[1].hand).not.toContain('d1');
    expect(harness.state.players[2].hand).toContain('d1');
  });
});
