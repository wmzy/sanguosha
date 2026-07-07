// 连营(陆逊·被动技)测试:当你失去最后的手牌时,你可以摸一张牌。
//
// 验证:
//   1. 弃置最后的手牌 → 触发连营 → 确认 → 摸一张牌(手牌数 0→1)
//   2. 移动牌(打出)最后的手牌 → 触发连营 → 确认 → 摸一张牌
//   3. 被获得最后的手牌 → 触发连营 → 确认 → 摸一张牌
//   4. 不发动:可选不摸牌
//   5. 负面:失去非最后的手牌(手牌>0) → 不触发
//   6. 负面:弃置装备(手牌本就为 0) → 不误触发
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
  suit: '♠' | '♥' | '♣' | '♦',
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
    judgeZone: [],
  };
}

describe('连营', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 弃置最后的手牌 → 触发 → 摸牌 ────────────────────
  it('弃置最后的手牌 → 确认发动 → 摸一张牌(手牌 0→1)', async () => {
    const last = makeCard('c1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        // P0 = 陆逊(连营),持有 1 张手牌
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['连营'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: last },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 弃置最后一张手牌
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1'] });
    await harness.waitForStable();

    // 连营询问发动
    P0.expectPending('请求回应');
    await P0.respond('连营', { choice: true });
    await harness.waitForStable();

    // 摸了一张牌(从测试牌堆顶)
    expect(harness.state.players[0].hand.length).toBe(1);
    // 原牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
  });

  // ─── 2. 移动牌(打出)最后的手牌 → 触发 ────────────────────
  it('移动牌打出最后的手牌 → 确认发动 → 摸一张牌', async () => {
    const last = makeCard('c1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['连营'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: last },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 移动牌:手牌 → 弃牌堆(模拟打出后入弃牌堆,如无懈可击路径)
    void applyAtom(harness.state, {
      type: '移动牌',
      cardId: 'c1',
      from: { zone: '手牌', player: 0 },
      to: { zone: '弃牌堆' },
    });
    await harness.waitForStable();

    P0.expectPending('请求回应');
    await P0.respond('连营', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(1);
  });

  // ─── 3. 被获得最后的手牌 → 触发 ────────────────────
  it('被获得最后的手牌 → 确认发动 → 摸一张牌', async () => {
    const last = makeCard('c1', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['连营'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: last },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // P1 从 P0 获得最后一张手牌
    void applyAtom(harness.state, { type: '获得', player: 1, cardId: 'c1', from: 0 });
    await harness.waitForStable();

    P0.expectPending('请求回应');
    await P0.respond('连营', { choice: true });
    await harness.waitForStable();

    expect(harness.state.players[0].hand.length).toBe(1);
    // 被获得的牌进了 P1 手牌
    expect(harness.state.players[1].hand).toContain('c1');
  });

  // ─── 4. 不发动:可选不摸牌 ────────────────────
  it('不发动连营 → 不摸牌(手牌保持 0)', async () => {
    const last = makeCard('c1', '杀', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['连营'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: last },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1'] });
    await harness.waitForStable();
    P0.expectPending('请求回应');

    // 选择不发动(choice=false → 超时/放弃)
    await P0.respond('连营', { choice: false });
    await harness.waitForStable();

    // 不摸牌,手牌仍为 0
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 5. 负面:失去非最后的手牌(手牌>0) → 不触发 ────────────────────
  it('负面:仍有手牌时失去一张 → 连营不触发(无询问)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5');
    const c2 = makeCard('c2', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'], skills: ['连营'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 弃置 1 张(还剩 1 张)
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['c1'] });
    await harness.waitForStable();

    // 手牌未归零 → 不触发连营(无 pending)
    expect(harness.state.players[0].hand.length).toBe(1);
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 6. 负面:手牌本就为 0、只弃装备 → 不误触发 ────────────────────
  it('负面:手牌为 0 时弃置装备 → 不误触发连营', async () => {
    const weapon = makeCard('w1', '诸葛连弩', '♣', 'A', '装备牌');
    (weapon as Card & { subtype?: string }).subtype = '武器';
    const state: GameState = createGameState({
      players: [
        // P0 = 陆逊(连营),0 手牌,持有一件装备
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['连营'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // 手工挂装备(不走 装备 atom,避免触发装备技能加载)
    state.players[0].equipment = { 武器: 'w1' };
    await harness.setup(state);

    // 弃置装备(非手牌)——手牌本就为 0
    void applyAtom(harness.state, { type: '弃置', player: 0, cardIds: ['w1'] });
    await harness.waitForStable();

    // 连营不误触发(无 pending)
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand.length).toBe(0);
  });
});
