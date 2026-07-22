// 界灭计(界李儒·群·主动技)测试(界限突破版):
//   "出牌阶段限一次,你可以将一张锦囊牌置于牌堆顶并令一名有手牌的其他角色
//    选择一项:1.弃置一张锦囊牌;2.依次弃置两张牌。"
//
// 用例:
//   1. happy path:目标选 2(依次弃两张)→ 置顶锦囊 + 目标弃两张任意牌
//   2. 目标选 1(弃锦囊)→ 置顶锦囊 + 目标弃一张锦囊
//   3. 目标只有 1 张锦囊(手牌=1,无法弃两张)→ 强制选 1
//   4. 目标无锦囊(有 ≥2 手牌)→ 强制选 2
//   5. 目标只有 1 张非锦囊手牌 → 无效果(置顶后流程结束)
//   6. 自己手牌无锦囊 → 拒绝
//   7. 目标 = 自己 → 拒绝
//   8. 目标无手牌 → 拒绝
//   9. 限一次:第二次发动 → 拒绝
//  10. 非出牌阶段 → 拒绝
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
  trickSubtype?: '普通锦囊' | '延时锦囊' | '响应锦囊',
): Card {
  const c: Card = { id, name, suit, color: suitColor(suit), rank, type };
  if (trickSubtype) c.trickSubtype = trickSubtype;
  return c;
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
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
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: '群',
  };
}

function trick(id: string, name = '过河拆桥'): Card {
  return makeCard(id, name, '♠', 'A', '锦囊牌', '普通锦囊');
}

function basic(id: string, name = '杀'): Card {
  return makeCard(id, name, '♠', 'A', '基本牌');
}

describe('界灭计', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. happy path:目标选 2 → 置顶锦囊 + 目标弃两张 ──────────
  it('目标选 2:置顶锦囊 + 依次弃两张任意牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['t0'], // 锦囊牌
          skills: ['界灭计'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a', 'p1b', 'p1c'], // 3 张基本牌
          skills: [],
        }),
      ],
      cardMap: {
        t0: trick('t0'),
        p1a: basic('p1a'),
        p1b: basic('p1b', '闪'),
        p1c: basic('p1c', '桃'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界灭计', 'use', { cardId: 't0', target: 1 });
    P1.expectPending('请求回应'); // 选项 confirm

    // P1 选 2(cancel = false 表示选 cancelLabel='依次弃两张')
    await P1.respond('界灭计', { choice: false });
    P1.expectPending('请求回应'); // 第 1 张

    await P1.respond('界灭计', { cardId: 'p1a' });
    P1.expectPending('请求回应'); // 第 2 张

    await P1.respond('界灭计', { cardId: 'p1b' });
    await harness.waitForStable();

    // 置顶:t0 从 P0 手牌 → 牌堆顶(deck 末尾)
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('t0');
    // P1 弃了 p1a, p1b,剩 [p1c]
    expect(harness.state.players[1].hand).toEqual(['p1c']);
    expect(harness.state.zones.discardPile).toEqual(
      expect.arrayContaining(['p1a', 'p1b']),
    );
    // 限一次标记
    expect(harness.state.players[0].vars['界灭计/usedThisTurn']).toBe(true);
  });

  // ─── 2. 目标选 1:置顶锦囊 + 目标弃一张锦囊 ──────────────────
  it('目标选 1:置顶锦囊 + 目标弃一张锦囊', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['t0'],
          skills: ['界灭计'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['t1', 'p1a', 'p1b'], // 1 锦囊 + 2 基本
          skills: [],
        }),
      ],
      cardMap: {
        t0: trick('t0'),
        t1: trick('t1', '无中生有'),
        p1a: basic('p1a'),
        p1b: basic('p1b', '闪'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界灭计', 'use', { cardId: 't0', target: 1 });
    P1.expectPending('请求回应'); // confirm

    // P1 选 1(confirm = true 表示 confirmLabel='弃一张锦囊')
    await P1.respond('界灭计', { choice: true });
    P1.expectPending('请求回应'); // 选锦囊牌

    await P1.respond('界灭计', { cardId: 't1' });
    await harness.waitForStable();

    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('t0');
    // P1 弃了 t1,剩 [p1a, p1b]
    expect(harness.state.players[1].hand).toEqual(['p1a', 'p1b']);
    expect(harness.state.zones.discardPile).toContain('t1');
  });

  // ─── 3. 目标只有 1 张锦囊(无法弃两张)→ 强制选 1 ──────────
  it('目标只有 1 张锦囊 → 强制选 1,跳过 confirm', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['t0'],
          skills: ['界灭计'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['t1'], // 仅 1 张锦囊
          skills: [],
        }),
      ],
      cardMap: {
        t0: trick('t0'),
        t1: trick('t1', '无中生有'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界灭计', 'use', { cardId: 't0', target: 1 });
    // 跳过 confirm,直接弹"弃一张锦囊"
    P1.expectPending('请求回应');
    await P1.respond('界灭计', { cardId: 't1' });
    await harness.waitForStable();

    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('t0');
    expect(harness.state.players[1].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('t1');
  });

  // ─── 4. 目标无锦囊(有 ≥2 手牌)→ 强制选 2 ──────────────────
  it('目标无锦囊 → 强制选 2(依次弃两张)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['t0'],
          skills: ['界灭计'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a', 'p1b'], // 仅基本牌
          skills: [],
        }),
      ],
      cardMap: {
        t0: trick('t0'),
        p1a: basic('p1a'),
        p1b: basic('p1b', '闪'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.triggerAction('界灭计', 'use', { cardId: 't0', target: 1 });
    // 跳过 confirm,直接弹"弃两张"
    P1.expectPending('请求回应');
    await P1.respond('界灭计', { cardId: 'p1a' });
    P1.expectPending('请求回应');
    await P1.respond('界灭计', { cardId: 'p1b' });
    await harness.waitForStable();

    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('t0');
    expect(harness.state.players[1].hand).toEqual([]);
  });

  // ─── 5. 目标只有 1 张非锦囊手牌 → 无效果 ──────────────────
  it('目标只有 1 张非锦囊手牌 → 置顶后流程结束(无效果)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['t0'],
          skills: ['界灭计'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a'], // 仅 1 张基本
          skills: [],
        }),
      ],
      cardMap: {
        t0: trick('t0'),
        p1a: basic('p1a'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.triggerAction('界灭计', 'use', { cardId: 't0', target: 1 });
    await harness.waitForStable();

    // 置顶已收(锦囊在牌堆顶)
    expect(harness.state.zones.deck[harness.state.zones.deck.length - 1]).toBe('t0');
    expect(harness.state.players[0].hand).toEqual([]);
    // P1 未受影响
    expect(harness.state.players[1].hand).toEqual(['p1a']);
    expect(harness.state.zones.discardPile).toEqual([]);
    // 限一次标记仍设(发动了,虽无效果)
    expect(harness.state.players[0].vars['界灭计/usedThisTurn']).toBe(true);
  });

  // ─── 6. 自己手牌无锦囊 → 拒绝 ──────────────────────────────
  it('自己手牌无锦囊 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['p0a'],
          skills: ['界灭计'],
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
        p0a: basic('p0a'),
        p1a: basic('p1a'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界灭计',
      actionType: 'use',
      params: { cardId: 'p0a', target: 1 },
    });
  });

  // ─── 7. 目标 = 自己 → 拒绝 ────────────────────────────────
  it('目标 = 自己 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['t0', 'p0a'],
          skills: ['界灭计'],
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
        t0: trick('t0'),
        p0a: basic('p0a'),
        p1a: basic('p1a'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界灭计',
      actionType: 'use',
      params: { cardId: 't0', target: 0 },
    });
  });

  // ─── 8. 目标无手牌 → 拒绝 ────────────────────────────────
  it('目标无手牌 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['t0'],
          skills: ['界灭计'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: [],
          skills: [],
        }),
      ],
      cardMap: {
        t0: trick('t0'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界灭计',
      actionType: 'use',
      params: { cardId: 't0', target: 1 },
    });
  });

  // ─── 9. 限一次:第二次发动 → 拒绝 ──────────────────────────
  it('限一次:第二次发动 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['t0', 't0b'],
          skills: ['界灭计'],
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
        t0: trick('t0'),
        t0b: trick('t0b', '无中生有'),
        p1a: basic('p1a'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 第一次发动
    await P0.triggerAction('界灭计', 'use', { cardId: 't0', target: 1 });
    await harness.waitForStable();
    expect(harness.state.players[0].vars['界灭计/usedThisTurn']).toBe(true);

    // 第二次 → 拒绝
    await P0.expectRejected({
      skillId: '界灭计',
      actionType: 'use',
      params: { cardId: 't0b', target: 1 },
    });
  });

  // ─── 10. 非出牌阶段 → 拒绝 ────────────────────────────────
  it('非出牌阶段(摸牌阶段)→ 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['t0'],
          skills: ['界灭计'],
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
        t0: trick('t0'),
        p1a: basic('p1a'),
      },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界灭计',
      actionType: 'use',
      params: { cardId: 't0', target: 1 },
    });
  });
});
