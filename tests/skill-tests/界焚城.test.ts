// 界焚城(界李儒·群·限定技)测试(界限突破版):
//   "限定技,出牌阶段,你可以选择一名其他角色开始,
//    令所有其他角色依次选择一项:1.弃置任意张牌(须比上家弃置的牌多);
//    2.受到你造成的2点火焰伤害。"
//
// 用例:
//   1. happy path:P0 选 P1 起点 → P1 弃 1 → P2 弃 2 → P3 受 2 火伤
//   2. 选 P2 起点 → 从 P2 开始遍历(P3 → P1)
//   3. 第一位弃 X 张后,第二位必须弃 > X 张
//   4. 目标手牌不足 → 强制受伤
//   5. 限定技:第二次发动 → 拒绝
//   6. 非自己回合 → 拒绝
//   7. 非出牌阶段 → 拒绝
//   8. 起点选择无效 → 拒绝
//   9. 弃牌张数 ≤ 上家 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name = '杀',
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
): Card {
  return { id, name, suit, color: suitColor(suit), rank: 'A', type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界李儒',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: (opts.vars as PlayerState['vars']) ?? {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: '群',
  };
}

describe('界焚城', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path:P0 选 P1 起点 → P1 弃 1 → P2 弃 2 → P3 受 2 火伤 ───
  it('happy path:从 P1 起,P1 弃1, P2 弃2, P3 受伤', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界焚城'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a'],
          skills: [],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['p2a', 'p2b', 'p2c'],
          skills: [],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 3,
          name: 'P3',
          character: '孙权',
          hand: ['p3a', 'p3b', 'p3c'], // 3 张(可选弃 ≥3 张或受伤)
          skills: [],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a'),
        p2a: makeCard('p2a'),
        p2b: makeCard('p2b', '闪', '♥'),
        p2c: makeCard('p2c', '桃', '♦'),
        p3a: makeCard('p3a'),
        p3b: makeCard('p3b', '酒', '♣'),
        p3c: makeCard('p3c'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    // P0 发动焚城
    await P0.triggerAction('界焚城', 'use', {});
    P0.expectPending('请求回应'); // 选起点

    await P0.respond('界焚城', { targets: [1] }); // 起点 P1
    P1.expectPending('请求回应'); // confirm

    // P1 弃 1 张(confirm=true = 弃 ≥1)
    await P1.respond('界焚城', { choice: true });
    P1.expectPending('请求回应'); // 弃牌
    await P1.respond('界焚城', { cardIds: ['p1a'] });

    // P2 弃 ≥ 2 张(confirm=true)
    P2.expectPending('请求回应');
    await P2.respond('界焚城', { choice: true });
    P2.expectPending('请求回应');
    await P2.respond('界焚城', { cardIds: ['p2a', 'p2b'] });

    // P3 选择受伤(choice=false)
    P3.expectPending('请求回应');
    await P3.respond('界焚城', { choice: false });
    await harness.waitForStable();

    // P1 弃 1,P2 弃 2,P3 受 2 点火焰伤害
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.players[2].hand).toEqual(['p2c']);
    expect(harness.state.players[3].health).toBe(1); // 3 - 2 = 1
    expect(harness.state.players[3].hand).toEqual(['p3a', 'p3b', 'p3c']); // 未弃
    // 限定技标记
    expect(harness.state.players[0].vars['界焚城/used']).toBe(true);
  });

  // ─── 2. 选 P2 起点 → 从 P2 开始遍历(P2 → P3 → P1)────────
  it('选 P2 起点 → 从 P2 开始: P2 → P3 → P1', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界焚城'],
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
        makePlayer({
          index: 3,
          name: 'P3',
          character: '孙权',
          hand: ['p3a', 'p3b'],
          skills: [],
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a'),
        p1b: makeCard('p1b', '闪', '♥'),
        p1c: makeCard('p1c', '桃', '♦'),
        p2a: makeCard('p2a'),
        p3a: makeCard('p3a'),
        p3b: makeCard('p3b', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');
    const P1 = harness.player('P1');

    await P0.triggerAction('界焚城', 'use', {});
    P0.expectPending('请求回应');
    await P0.respond('界焚城', { targets: [2] }); // 起点 P2

    // 顺序:P2 → P3 → P1
    P2.expectPending('请求回应');
    await P2.respond('界焚城', { choice: true });
    P2.expectPending('请求回应');
    await P2.respond('界焚城', { cardIds: ['p2a'] }); // 弃 1

    // P3:必须 ≥2 张(手牌恰好 2)
    P3.expectPending('请求回应');
    await P3.respond('界焚城', { choice: true });
    P3.expectPending('请求回应');
    await P3.respond('界焚城', { cardIds: ['p3a', 'p3b'] }); // 弃 2

    // P1:必须 ≥3 张(手牌恰好 3)
    P1.expectPending('请求回应');
    await P1.respond('界焚城', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界焚城', { cardIds: ['p1a', 'p1b', 'p1c'] }); // 弃 3

    await harness.waitForStable();
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.players[2].hand).toEqual([]);
    expect(harness.state.players[3].hand).toEqual([]);
  });

  // ─── 3. 目标手牌不足 → 强制受伤 ──────────────────────────
  it('目标手牌不足(2 张 < 上家弃 2 的 ≥3)→ 强制受伤', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界焚城'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a', 'p1b', 'p1c'], // 3 张
          skills: [],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          hand: ['p2a', 'p2b'], // 2 张
          skills: [],
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a'),
        p1b: makeCard('p1b', '闪', '♥'),
        p1c: makeCard('p1c', '桃', '♦'),
        p2a: makeCard('p2a'),
        p2b: makeCard('p2b', '酒', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P0.triggerAction('界焚城', 'use', {});
    P0.expectPending('请求回应');
    await P0.respond('界焚城', { targets: [1] });

    // P1 弃 3 张
    P1.expectPending('请求回应');
    await P1.respond('界焚城', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界焚城', { cardIds: ['p1a', 'p1b', 'p1c'] });

    // P2 手牌=2,上家弃3 → 必须 ≥4 → 不足 → 强制受伤(无 confirm)
    await harness.waitForStable();
    // P2 直接受 2 点伤害(跳过 confirm,因为 canDiscard = 2 > 3 = false)
    expect(harness.state.players[2].health).toBe(1); // 3 - 2 = 1
    expect(harness.state.players[2].hand).toEqual(['p2a', 'p2b']); // 未弃
  });

  // ─── 4. 限定技:第二次发动 → 拒绝 ──────────────────────────
  it('限定技:第二次发动 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界焚城'],
          // 已用过限定技
          vars: { '界焚城/used': true },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a'],
          skills: [],
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界焚城',
      actionType: 'use',
      params: {},
    });
  });

  // ─── 5. 非自己回合 → 拒绝 ────────────────────────────────
  it('非自己回合 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界焚城'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a'],
          skills: [],
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a'),
      },
      currentPlayerIndex: 1, // P1 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界焚城',
      actionType: 'use',
      params: {},
    });
  });

  // ─── 6. 非出牌阶段 → 拒绝 ────────────────────────────────
  it('非出牌阶段(摸牌阶段)→ 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界焚城'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a'],
          skills: [],
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a'),
      },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界焚城',
      actionType: 'use',
      params: {},
    });
  });

  // ─── 7. 起点选择无效(选自己)→ 拒绝 ────────────────────────
  it('起点选择无效(选自己)→ 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界焚城'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a'],
          skills: [],
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界焚城', 'use', {});
    P0.expectPending('请求回应'); // 选起点

    await P0.expectRejected({
      skillId: '界焚城',
      actionType: 'respond',
      params: { targets: [0] }, // 选自己
    });
  });

  // ─── 8. 弃牌张数 ≤ 上家 → 拒绝 ────────────────────────────
  it('弃牌张数 ≤ 上家 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [],
          skills: ['界焚城'],
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
          hand: ['p2a', 'p2b', 'p2c'],
          skills: [],
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a'),
        p1b: makeCard('p1b', '闪', '♥'),
        p1c: makeCard('p1c', '桃', '♦'),
        p2a: makeCard('p2a'),
        p2b: makeCard('p2b', '酒', '♣'),
        p2c: makeCard('p2c'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P0.triggerAction('界焚城', 'use', {});
    P0.expectPending('请求回应');
    await P0.respond('界焚城', { targets: [1] });

    // P1 弃 2 张
    P1.expectPending('请求回应');
    await P1.respond('界焚城', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界焚城', { cardIds: ['p1a', 'p1b'] }); // 弃 2

    // P2 选弃牌但只弃 2(=上家)→ 拒绝
    P2.expectPending('请求回应');
    await P2.respond('界焚城', { choice: true });
    P2.expectPending('请求回应');
    await P2.expectRejected({
      skillId: '界焚城',
      actionType: 'respond',
      params: { cardIds: ['p2a', 'p2b'] }, // 弃 2 = 上家(应 > 2)
    });
  });
});
