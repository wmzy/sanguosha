// 黄天(张角·主公技):其他群势力角色可在出牌阶段将一张【闪】或【闪电】交给你。
//   每名角色每回合限一次。
//
// 覆盖:
//   1. 群盟友交闪给张角(主公)→ 牌转移
//   2. 交闪电 → 牌转移(闪/闪电均可)
//   3. 每回合限一次 → 第二次被拒
//   4. 非群势力 → 不可用
//   5. 张角非主公 → 不可用
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

describe('黄天', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 群盟友交闪给张角(主公) ────────────────────────────
  it('群盟友出牌阶段交闪给张角 → 牌转移到张角手牌', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: [],
          skills: ['黄天', '回合管理'],
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

    await P1.useCard('黄天', 'd1');
    await waitForStable(harness.state);

    // 闪转移到张角手牌
    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.players[1].hand).not.toContain('d1');
  });

  // ─── 2. 交闪电 → 牌转移 ──────────────────────────────────
  it('群盟友交闪电给张角 → 牌转移', async () => {
    const lightning = makeCard('lt1', '闪电', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: [],
          skills: ['黄天', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '群盟友',
          faction: '群',
          hand: ['lt1'],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { lt1: lightning },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('群盟友');

    await P1.useCard('黄天', 'lt1');
    await waitForStable(harness.state);

    expect(harness.state.players[0].hand).toContain('lt1');
    expect(harness.state.players[1].hand).not.toContain('lt1');
  });

  // ─── 3. 每回合限一次 → 第二次被拒 ────────────────────────
  it('同一盟友每回合只能交一次 → 第二次被拒', async () => {
    const dodge1 = makeCard('d1', '闪', '♥', '2');
    const dodge2 = makeCard('d2', '闪', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: [],
          skills: ['黄天', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '群盟友',
          faction: '群',
          hand: ['d1', 'd2'],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { d1: dodge1, d2: dodge2 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('群盟友');

    // 第一次:成功
    await P1.useCard('黄天', 'd1');
    await waitForStable(harness.state);
    expect(harness.state.players[0].hand).toContain('d1');

    // 第二次:被拒(每回合限一次)
    await P1.expectRejected({
      skillId: '黄天',
      actionType: 'use',
      params: { cardId: 'd2' },
    });
    expect(harness.state.players[1].hand).toContain('d2'); // 第二张未交出
  });

  // ─── 4. 非群势力 → 不可用 ────────────────────────────────
  it('非群势力角色不能使用黄天 → 被拒', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: [],
          skills: ['黄天', '回合管理'],
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

    // 魏势力没有注册黄天 action → 被拒
    await P1.expectRejected({
      skillId: '黄天',
      actionType: 'use',
      params: { cardId: 'd1' },
    });
    expect(harness.state.players[1].hand).toContain('d1'); // 牌未交出
  });

  // ─── 5. 张角非主公 → 不可用 ──────────────────────────────
  it('张角非主公(ownerId≠0)→ 黄天不可用', async () => {
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        // P0 = 主公(非张角)
        makePlayer({
          index: 0,
          name: '主公',
          character: '刘备',
          faction: '蜀',
          hand: [],
          skills: ['回合管理'],
          health: 4,
        }),
        // P1 = 张角(非主公,index=1)
        makePlayer({
          index: 1,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: [],
          skills: ['黄天', '回合管理'],
          health: 3,
        }),
        // P2 = 群盟友
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
      currentPlayerIndex: 2, // P2 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P2 = harness.player('群盟友');

    // 张角(ownerId=1)非主公 → 黄天被拒
    await P2.expectRejected({
      skillId: '黄天',
      actionType: 'use',
      params: { cardId: 'd1' },
    });
    expect(harness.state.players[2].hand).toContain('d1'); // 牌未交出
  });

  // ─── 6. 非闪/闪电的牌不可交 ──────────────────────────────
  it('只能交闪或闪电 → 交杀被拒', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '张角',
          character: '张角',
          faction: '群',
          hand: [],
          skills: ['黄天', '回合管理'],
          health: 3,
        }),
        makePlayer({
          index: 1,
          name: '群盟友',
          faction: '群',
          hand: ['k1'],
          skills: ['回合管理'],
          health: 4,
        }),
      ],
      cardMap: { k1: kill },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('群盟友');

    await P1.expectRejected({
      skillId: '黄天',
      actionType: 'use',
      params: { cardId: 'k1' },
    });
    expect(harness.state.players[1].hand).toContain('k1'); // 牌未交出
  });
});
