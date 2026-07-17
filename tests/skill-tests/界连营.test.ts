// 界连营(界陆逊·被动技)测试:当你失去所有手牌后,你可以令至多X名角色各摸一张牌
//   (X为你失去的手牌数)。
//
// 验证:
//   1. 一次弃置最后 2 张手牌 → X=2 → 确认 → 选 P1/P2 各摸一张
//   2. X=失去手牌数:弃置 1 张(手牌仅 1) → X=1 → 越权选 2 名只生效 1 名(clamp)
//   3. 可选择少于 X:一次弃置 3 张 → X=3 → 只选 1 名,仅其摸牌
//   4. 可包含自己:弃置 1 张 → X=1 → 选自己 → 自己摸一张(手牌 0→1)
//   5. 不发动:confirm=false → 无人摸牌
//   6. 负面:仍有手牌时失去一张 → 不触发
//   7. 移出游戏(界谦逊联动):一次移出 3 张整手牌 → X=3
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
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
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '陆逊',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
  };
}

describe('界连营', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 一次弃置最后 2 张手牌 → X=2 → 选 P1/P2 各摸一张 ────────────────────
  it('一次弃置最后 2 张手牌 → X=2 → 确认 → 选 P1/P2 → 各摸一张牌', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const d1 = makeCard('d1', '闪', '♥', '3');
    const d2 = makeCard('d2', '桃', '♦', '7');
    const state: GameState = createGameState({
      players: [
        // P0 = 界陆逊(界连营),持 2 张手牌 → 一次弃置后 X=2
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界连营'],
          health: 2,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
      ],
      cardMap: { c1, c2, d1, d2 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 一次弃置最后两张手牌
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1', 'c2'] });
    await harness.waitForStable();

    // ① 界连营 trigger 询问(X=2)
    P0.expectPending('请求回应');
    await P0.respond('界连营', { choice: true }); // 发动
    await harness.waitForStable();

    // ② 选 P1、P2 各摸一张
    await P0.respond('界连营', { targets: [1, 2] });
    await harness.waitForStable();

    // P1、P2 各摸一张(来自牌堆 d1/d2)
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(1);
    const drawn = new Set(['d1', 'd2']);
    expect(drawn.has(harness.state.players[1].hand[0])).toBe(true);
    expect(drawn.has(harness.state.players[2].hand[0])).toBe(true);
    expect(harness.state.players[1].hand[0]).not.toBe(harness.state.players[2].hand[0]);
    // 界陆逊未选自己 → 手牌仍为 0
    expect(harness.state.players[0].hand.length).toBe(0);
    // 原牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
    // 牌堆被摸走 2 张
    expect(harness.state.zones.deck.length).toBe(0);
  });

  // ─── 2. X=失去手牌数:弃置 1 张 → X=1 → 越权选 2 名只生效 1 名 ────────────────
  it('X=失去手牌数:弃置 1 张(手牌仅 1)时 X=1,越权选 2 名只生效 1 名', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const d1 = makeCard('d1', '闪', '♥', '3');
    const d2 = makeCard('d2', '桃', '♦', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界连营'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
      ],
      cardMap: { c1, d1, d2 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1'] });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界连营', { choice: true });
    await harness.waitForStable();

    // 越权尝试选 2 名;X=1 → clamp 后仅第一名摸牌
    await P0.respond('界连营', { targets: [1, 2] });
    await harness.waitForStable();

    // 仅 P1 摸一张,P2 不摸
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(0);
    // 牌堆只少 1 张
    expect(harness.state.zones.deck.length).toBe(1);
  });

  // ─── 3. 可选择少于 X:一次弃置 3 张 → X=3 → 只选 1 名 ────────────────────
  it('可选择少于 X 名:一次弃置 3 张 → X=3 → 只选 P1 → 仅 P1 摸一张', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const c3 = makeCard('c3', '桃', '♦', '7');
    const d1 = makeCard('d1', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2', 'c3'],
          skills: ['界连营'],
          health: 1,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
      ],
      cardMap: { c1, c2, c3, d1 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1', 'c2', 'c3'] });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界连营', { choice: true });
    await harness.waitForStable();

    // X=3 但只选 1 名
    await P0.respond('界连营', { targets: [1] });
    await harness.waitForStable();

    // 仅 P1 摸一张,其余未摸
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[1].hand[0]).toBe('d1');
    expect(harness.state.players[2].hand.length).toBe(0);
    expect(harness.state.players[3].hand.length).toBe(0);
    expect(harness.state.zones.deck.length).toBe(0);
  });

  // ─── 4. 可包含自己:弃置 1 张 → X=1 → 选自己 ────────────────────
  it('可令自己摸牌:弃置 1 张 → X=1 → 选自己 → 手牌 0→1', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const d1 = makeCard('d1', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['界连营'],
          health: 3,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, d1 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1'] });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('界连营', { choice: true });
    await harness.waitForStable();

    // 选自己(座次 0)
    await P0.respond('界连营', { targets: [0] });
    await harness.waitForStable();

    // 自己摸一张
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.players[0].hand[0]).toBe('d1');
    expect(harness.state.players[1].hand.length).toBe(0);
  });

  // ─── 5. 不发动:confirm=false → 无人摸牌 ────────────────────
  it('不发动界连营 → 无人摸牌', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const d1 = makeCard('d1', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界连营'],
          health: 2,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2, d1 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1', 'c2'] });
    await harness.waitForStable();
    P0.expectPending('请求回应');

    // 选择不发动
    await P0.respond('界连营', { choice: false });
    await harness.waitForStable();

    // 无人摸牌
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[1].hand.length).toBe(0);
    expect(harness.state.zones.deck.length).toBe(1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 6. 负面:仍有手牌时失去一张 → 不触发 ────────────────────
  it('负面:仍有手牌时失去一张 → 界连营不触发(无询问)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2'],
          skills: ['界连营'],
          health: 2,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await harness.setup(state);

    // 弃置 1 张(还剩 1 张)
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1'] });
    await harness.waitForStable();

    // 手牌未归零 → 不触发界连营(无 pending)
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 7. 移出游戏(界谦逊联动):一次移出 3 张整手牌 → X=3 ────────────────────
  it('移出游戏一次移走 3 张整手牌 → 界连营 X=3(失去的手牌数)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const c3 = makeCard('c3', '桃', '♦', '7');
    const d1 = makeCard('d1', '闪', '♥', '3');
    const d2 = makeCard('d2', '桃', '♦', '7');
    const d3 = makeCard('d3', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1', 'c2', 'c3'],
          skills: ['界连营'],
          health: 1,
          maxHealth: 3,
          character: '界陆逊',
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
        makePlayer({ index: 3, name: 'P3', character: '孙权' }),
      ],
      cardMap: { c1, c2, c3, d1, d2, d3 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2', 'd3'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 界谦逊把整手牌移出游戏(直接调用 atom,模拟谦逊确认后的效果)
    void applyAtom(harness.state, {
      type: '移出游戏',
      player: 0,
      cardIds: ['c1', 'c2', 'c3'],
    });
    await harness.waitForStable();

    // 移出后手牌归零 → 界连营触发,X=3(失去 3 张)
    P0.expectPending('请求回应');
    await P0.respond('界连营', { choice: true });
    await harness.waitForStable();
    // X=3 → 可选 3 名
    await P0.respond('界连营', { targets: [1, 2, 3] });
    await harness.waitForStable();

    // P1/P2/P3 各摸一张(X=3 全用满)
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(1);
    expect(harness.state.players[3].hand.length).toBe(1);
    expect(harness.state.zones.deck.length).toBe(0);
    // 移出的牌在 vars 中(未进弃牌堆,未在手牌)
    expect(harness.state.zones.discardPile).toHaveLength(0);
    expect(harness.state.players[0].vars['界谦逊/移出']).toEqual(['c1', 'c2', 'c3']);
  });
});
