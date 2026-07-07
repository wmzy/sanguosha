// 好施(鲁肃·吴·主动技)测试
//   摸牌阶段，你可以额外摸两张牌，若此时你的手牌数超过五张，
//   你必须将一半（向下取整）的手牌交给除你外手牌数最少的一名角色。
//
// 验证:
//   1. 发动好施 + 手牌 ≤ 5 → 额外摸 2 张(共 4 张),无需给牌
//   2. 发动好施 + 手牌 > 5 → 额外摸 2 张,给 floor(handCount/2) 张给手牌最少的角色
//   3. 不发动好施 → 正常摸 2 张
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

describe('好施', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 发动好施,手牌 ≤ 5 → 摸 4 张,无需给牌 ─────────────
  it('发动好施 + 手牌=4(≤5):摸 4 张,无需给牌', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          hand: [],
          skills: ['好施', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        d1: makeCard('d1', '杀', '♠'),
        d2: makeCard('d2', '闪', '♥'),
        d3: makeCard('d3', '桃', '♦'),
        d4: makeCard('d4', '酒', '♣'),
      },
      zones: { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('鲁肃');

    await P0.triggerAction('回合管理', 'start');
    P0.expectPending('请求回应');
    await P0.respond('好施', { choice: true }); // 发动好施

    // 摸 4 张(2+2),手牌 = 4 ≤ 5,无需给牌
    expect(harness.state.players[0].hand.length).toBe(4);
    // 牌堆消耗 4 张(剩 0)
    expect(harness.state.zones.deck.length).toBe(0);
    // 限一次标记已设
    expect(harness.state.players[0].vars['好施/usedThisTurn']).toBe(true);
  });

  // ─── 2. 发动好施,手牌 > 5 → 给 floor(handCount/2) 张 ──────
  it('发动好施 + 手牌=7(>5):给 3 张给手牌最少的角色', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          hand: ['h1', 'h2', 'h3'],
          skills: ['好施', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: [],
          skills: ['回合管理'],
        }),
      ],
      cardMap: {
        h1: makeCard('h1', '杀'),
        h2: makeCard('h2', '闪'),
        h3: makeCard('h3', '桃', '♦'),
        d1: makeCard('d1', '杀', '♠'),
        d2: makeCard('d2', '闪', '♥'),
        d3: makeCard('d3', '桃', '♦'),
        d4: makeCard('d4', '酒', '♣'),
      },
      zones: { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('鲁肃');

    await P0.triggerAction('回合管理', 'start');
    P0.expectPending('请求回应');
    await P0.respond('好施', { choice: true }); // 发动好施

    // 手牌 = 3(初始) + 4(摸) = 7 > 5 → 需给 floor(7/2) = 3 张
    // P1 手牌=0 是最少的 → 自动选中(唯一最少)
    // 出现选牌 pending
    P0.expectPending('请求回应');
    await P0.respond('好施', { cardIds: ['d1', 'd2', 'd3'] }); // 给 3 张

    // 鲁肃:7 - 3 = 4 张
    expect(harness.state.players[0].hand.length).toBe(4);
    expect(harness.state.players[0].hand).not.toContain('d1');
    expect(harness.state.players[0].hand).not.toContain('d2');
    expect(harness.state.players[0].hand).not.toContain('d3');
    // P1:0 + 3 = 3 张
    expect(harness.state.players[1].hand.length).toBe(3);
    expect(harness.state.players[1].hand).toEqual(expect.arrayContaining(['d1', 'd2', 'd3']));
  });

  // ─── 3. 不发动好施 → 正常摸 2 张 ─────────────────────────
  it('不发动好施 → 正常摸 2 张', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '鲁肃',
          hand: [],
          skills: ['好施', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          hand: ['p1a'],
          skills: ['回合管理'],
        }),
      ],
      cardMap: {
        p1a: makeCard('p1a', '杀'),
        d1: makeCard('d1', '杀', '♠'),
        d2: makeCard('d2', '闪', '♥'),
      },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('鲁肃');

    await P0.triggerAction('回合管理', 'start');
    P0.expectPending('请求回应');
    await P0.respond('好施', { choice: false }); // 不发动

    // 正常摸 2 张
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.zones.deck.length).toBe(0);
    expect(harness.state.players[0].vars['好施/usedThisTurn']).toBeUndefined();
  });
});
