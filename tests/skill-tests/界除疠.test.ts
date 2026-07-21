// 界除疠(界华佗·群雄·主动技)测试(界限突破版):
//   出牌阶段限一次,选择任意名势力各不相同的其他角色,
//   弃置你和这些角色的各一张牌,被弃置黑桃牌的角色各摸一张牌。
//
// 用例:
//   1. happy path:1 名目标,自身弃红桃,目标唯一手牌黑桃被弃 → 目标摸 1,自身不摸
//   2. 自身弃黑桃:自身也摸 1
//   3. 多目标(势力各不相同):遍历自身+所有目标做黑桃补偿
//   4. 势力重复:2 名同势力目标 → 拒绝
//   5. 自己为目标 → 拒绝
//   6. 限一次:第二次发动 → 拒绝
//   7. 目标无牌可弃 → 拒绝
//   8. 非自己回合 / 非出牌阶段 → 拒绝
//   9. 0 名目标 → 拒绝(描述"任意名"但需至少 1 名才有战略意义)
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
  faction?: '魏' | '蜀' | '吴' | '群';
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界华佗',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction ?? '群',
    identity: '主公',
  };
}

describe('界除疠', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path:自身弃♥,目标唯一手牌♠被弃 → 目标摸 1,自身不摸 ────
  it('happy path:自身弃♥,目标唯一手牌♠被弃 → 目标摸 1,自身不摸', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          faction: '群',
          hand: ['c1'],
          skills: ['界除疠', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          faction: '魏',
          hand: ['p1a'],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♥'),
        p1a: makeCard('p1a', '杀', '♠'),
        // 牌堆:给黑桃补偿摸牌用
        d1: makeCard('d1', '闪', '♣'),
      },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界除疠', 'use', { cardId: 'c1', targets: [1] });

    // 自身:c1(♥)已弃,非黑桃 → 不摸 → 手牌空
    expect(harness.state.players[0].hand).not.toContain('c1');
    expect(harness.state.players[0].hand.length).toBe(0);
    // 目标:p1a(♠)被弃(唯一手牌,随机抽必然是它),黑桃 → 摸 1 → 手牌 = [d1]
    expect(harness.state.players[1].hand).not.toContain('p1a');
    expect(harness.state.players[1].hand).toEqual(['d1']);
    // 弃牌堆:c1, p1a
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['c1', 'p1a']));
    // 限一次标记已设置
    expect(harness.state.players[0].vars['界除疠/usedThisTurn']).toBe(true);
  });

  // ─── 2. 自身弃黑桃:自身也摸 1 ────────────────────────────
  it('自身弃♠:自身也摸 1(自身补偿)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          faction: '群',
          hand: ['c1'],
          skills: ['界除疠', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '刘备',
          faction: '蜀',
          hand: ['p1a'],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♠'),
        p1a: makeCard('p1a', '杀', '♥'),
        d1: makeCard('d1', '闪', '♣'),
      },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界除疠', 'use', { cardId: 'c1', targets: [1] });

    // 自身:c1(♠)已弃,黑桃 → 摸 1 → 手牌 = [d1]
    expect(harness.state.players[0].hand).toEqual(['d1']);
    // 目标:p1a(♥)被弃,非黑桃 → 不摸 → 手牌空
    expect(harness.state.players[1].hand).toEqual([]);
  });

  // ─── 3. 多目标(势力各不相同):遍历自身+所有目标做黑桃补偿 ────
  it('多目标:P1(魏)+P2(蜀),黑桃补偿遍历自身+所有目标', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          faction: '群',
          hand: ['c1'],
          skills: ['界除疠', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          faction: '魏',
          hand: ['p1a'], // ♠ → 摸 1
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '刘备',
          faction: '蜀',
          hand: ['p2a'], // ♣ → 不摸
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♥'),
        p1a: makeCard('p1a', '杀', '♠'),
        p2a: makeCard('p2a', '杀', '♣'),
        d1: makeCard('d1', '闪', '♦'),
      },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界除疠', 'use', { cardId: 'c1', targets: [1, 2] });

    // 自身:c1(♥)弃,非黑桃 → 不摸 → 空
    expect(harness.state.players[0].hand).toEqual([]);
    // P1:p1a(♠)弃 → 摸 1 → [d1]
    expect(harness.state.players[1].hand).toEqual(['d1']);
    // P2:p2a(♣)弃,非黑桃 → 不摸 → 空
    expect(harness.state.players[2].hand).toEqual([]);
    // 弃牌堆:c1, p1a, p2a
    expect(harness.state.zones.discardPile).toEqual(
      expect.arrayContaining(['c1', 'p1a', 'p2a']),
    );
  });

  // ─── 4. 势力重复:2 名同势力目标 → 拒绝 ────────────────────
  it('势力重复:2 名同势力目标 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          faction: '群',
          hand: ['c1'],
          skills: ['界除疠', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          faction: '魏',
          hand: ['p1a'],
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          character: '司马懿',
          faction: '魏', // 与 P1 同势力
          hand: ['p2a'],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♥'),
        p1a: makeCard('p1a', '杀', '♠'),
        p2a: makeCard('p2a', '杀', '♣'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界除疠',
      actionType: 'use',
      params: { cardId: 'c1', targets: [1, 2] },
    });
    // 未发动 → 限一次标记未设置
    expect(harness.state.players[0].vars['界除疠/usedThisTurn']).toBeUndefined();
    // 牌未被弃
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── 5. 自己为目标 → 拒绝 ────────────────────────────────
  it('自己为目标 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          faction: '群',
          hand: ['c1'],
          skills: ['界除疠', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          faction: '魏',
          hand: ['p1a'],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♥'),
        p1a: makeCard('p1a', '杀', '♠'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界除疠',
      actionType: 'use',
      params: { cardId: 'c1', targets: [0] },
    });
  });

  // ─── 6. 限一次:第二次发动 → 拒绝 ────────────────────────
  it('限一次:第二次发动 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          faction: '群',
          hand: ['c1', 'c2'],
          skills: ['界除疠', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          faction: '魏',
          hand: ['p1a', 'p1b'],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♥'),
        c2: makeCard('c2', '杀', '♣'),
        p1a: makeCard('p1a', '杀', '♠'),
        p1b: makeCard('p1b', '杀', '♦'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 第一次:允许
    await P0.triggerAction('界除疠', 'use', { cardId: 'c1', targets: [1] });
    expect(harness.state.players[0].vars['界除疠/usedThisTurn']).toBe(true);

    // 第二次:拒绝(限一次)
    await P0.expectRejected({
      skillId: '界除疠',
      actionType: 'use',
      params: { cardId: 'c2', targets: [1] },
    });
  });

  // ─── 7. 目标无牌可弃 → 拒绝 ──────────────────────────────
  it('目标无牌可弃 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          faction: '群',
          hand: ['c1'],
          skills: ['界除疠', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          faction: '魏',
          hand: [], // 无手牌
          equipment: {}, // 无装备
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♥'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界除疠',
      actionType: 'use',
      params: { cardId: 'c1', targets: [1] },
    });
  });

  // ─── 8. 非自己回合 → 拒绝 ────────────────────────────────
  it('非自己回合 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          faction: '群',
          hand: ['c1'],
          skills: ['界除疠', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          faction: '魏',
          hand: ['p1a'],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♥'),
        p1a: makeCard('p1a', '杀', '♠'),
      },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界除疠',
      actionType: 'use',
      params: { cardId: 'c1', targets: [1] },
    });
  });

  // ─── 9. 非出牌阶段 → 拒绝 ────────────────────────────────
  it('非出牌阶段(摸牌阶段)→ 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          faction: '群',
          hand: ['c1'],
          skills: ['界除疠', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          faction: '魏',
          hand: ['p1a'],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♥'),
        p1a: makeCard('p1a', '杀', '♠'),
      },
      currentPlayerIndex: 0,
      phase: '摸牌', // 非出牌阶段
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界除疠',
      actionType: 'use',
      params: { cardId: 'c1', targets: [1] },
    });
  });

  // ─── 10. 0 名目标 → 拒绝(至少 1 名才有意义)──────────────
  it('0 名目标 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          faction: '群',
          hand: ['c1'],
          skills: ['界除疠', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          faction: '魏',
          hand: ['p1a'],
        }),
      ],
      cardMap: {
        c1: makeCard('c1', '杀', '♥'),
        p1a: makeCard('p1a', '杀', '♠'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界除疠',
      actionType: 'use',
      params: { cardId: 'c1', targets: [] },
    });
  });
});
