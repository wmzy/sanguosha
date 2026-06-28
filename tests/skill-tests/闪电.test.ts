// tests/skill-tests/闪电.test.ts
// 闪电(延时锦囊,可传递):
//   判定黑桃2-9 → 自己受3点无来源伤害,闪电进弃牌堆。
//   其他结果 → 闪电传递给下家(判定区)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, fireTimeoutAndWait, waitForStable } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, Json, PlayerState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: { index: number; name: string; hand?: string[]; skills?: string[]; pendingTricks?: Array<{ name: string; source: number; card: Card }>; health?: number }): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {} as Record<string, Json>,
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    judgeZone: [],
    tags: [],
  };
}

describe('闪电', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. use action:对自己判定区放置延时锦囊
  // ─────────────────────────────────────────────────────────────
  it('use action:对自己放置 闪电 延时锦囊', async () => {
    const card = makeCard('sd1', '闪电', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['sd1'], skills: ['闪电', '回合管理'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: { sd1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.triggerAction('闪电', 'use', { cardId: 'sd1' });

    expect(harness.state.players[0].pendingTricks.length).toBe(1);
    expect(harness.state.players[0].pendingTricks[0].name).toBe('闪电');
    expect(harness.state.zones.discardPile).toContain('sd1');
    // view 级断言
    P1.processEvents();
    P1.expectView(v => {
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. 判定为黑桃 5(命中)→ 受3点伤害 + 移除闪电
  // ─────────────────────────────────────────────────────────────
  it('判定黑桃5(命中)→ P0 受3点伤害 + 闪电进弃牌堆', async () => {
    const card = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 0, card }],
          health: 4,
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: { sd1: card, j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

    // 黑桃5 ∈ [2-9] → 受3点伤害
    expect(harness.state.players[0].health).toBe(1); // 4 - 3
    // 闪电被移除
    expect(harness.state.players[0].pendingTricks.length).toBe(0);
    // view 级断言
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].health).toBe(1);
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. 判定为黑桃 K(非命中)→ 不受伤 + 闪电传给下家
  // ─────────────────────────────────────────────────────────────
  it('判定黑桃K(非命中)→ P0 不受伤 + 闪电传给 P1', async () => {
    const card = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', 'K');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 0, card }],
          health: 4,
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪电', '回合管理'], health: 4 }),
      ],
      cardMap: { sd1: card, j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

    // P0 未受伤
    expect(harness.state.players[0].health).toBe(4);
    // P0 判定区闪电已移除
    expect(harness.state.players[0].pendingTricks.length).toBe(0);
    // P1 判定区收到闪电
    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('闪电');
    // view 级断言
    P1.processEvents();
    P1.expectView(v => {
      expect(v.players[0].health).toBe(4);
      expect(v.pending).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. 判定边界:黑桃 2 命中(下界),黑桃 9 命中(上界)
  // ─────────────────────────────────────────────────────────────
  it('判定黑桃2/9(边界命中)→ 受3点伤害', async () => {
    for (const rank of ['2', '9']) {
      const card = makeCard('sd1', '闪电', '♠');
      const judgeCard = makeCard('j1', '判定牌', '♠', rank);
      const state: GameState = createGameState({
        players: [
          makePlayer({
            index: 0,
            name: 'P1',
            skills: ['闪电', '回合管理'],
            pendingTricks: [{ name: '闪电', source: 0, card }],
            health: 4,
          }),
          makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
        ],
        cardMap: { sd1: card, j1: judgeCard },
        currentPlayerIndex: 0,
        phase: '判定',
        turn: { round: 1, phase: '判定', vars: {} },
      });
      state.zones = { deck: ['j1'], discardPile: [], processing: [] };
      await harness.setup(state);

      void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

      expect(harness.state.players[0].health).toBe(1); // 4 - 3
      expect(harness.state.players[0].pendingTricks.length).toBe(0);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 5. 判定边界:黑桃 A(不命中),黑桃 10(不命中)
  // ─────────────────────────────────────────────────────────────
  it('判定黑桃A/10(边界不命中)→ 不受伤 + 传给下家', async () => {
    for (const rank of ['A', '10']) {
      const card = makeCard('sd1', '闪电', '♠');
      const judgeCard = makeCard('j1', '判定牌', '♠', rank);
      const state: GameState = createGameState({
        players: [
          makePlayer({
            index: 0,
            name: 'P1',
            skills: ['闪电', '回合管理'],
            pendingTricks: [{ name: '闪电', source: 0, card }],
            health: 4,
          }),
          makePlayer({ index: 1, name: 'P2', skills: ['闪电', '回合管理'], health: 4 }),
        ],
        cardMap: { sd1: card, j1: judgeCard },
        currentPlayerIndex: 0,
        phase: '判定',
        turn: { round: 1, phase: '判定', vars: {} },
      });
      state.zones = { deck: ['j1'], discardPile: [], processing: [] };
      await harness.setup(state);

      void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

      expect(harness.state.players[0].health).toBe(4);
      expect(harness.state.players[1].pendingTricks.length).toBe(1);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 6. 红心判定(非命中)→ 不受伤 + 传给下家
  // ─────────────────────────────────────────────────────────────
  it('判定红心(非命中)→ 不受伤 + 传给下家', async () => {
    const card = makeCard('sd1', '闪电', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 0, card }],
          health: 4,
        }),
        makePlayer({ index: 1, name: 'P2', skills: ['闪电', '回合管理'], health: 4 }),
      ],
      cardMap: { sd1: card, j1: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[1].pendingTricks.length).toBe(1);
  });

  // ────────────────────────────────────────────────────────────
  // 7. 判定前打出无懈可击 → 闪电被抵消:移除延时锦囊,不判定、不受伤、不传递
  //    (延时锦囊的无懈问询时机是判定阶段判定前,而非使用时)
  // ────────────────────────────────────────────────────────────
  it('判定前打出无懈可击 → 闪电被抵消,不判定不受伤不传递', async () => {
    const card = makeCard('sd1', '闪电', '♠');
    // 判定牌为黑桃5(命中)——若未被无懈抵消将造成 3 点伤害
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    // P1 持有一张无懈可击
    const nullifCard = makeCard('wx1', '无懈可击', '♠', 'J');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          skills: ['闪电', '回合管理'],
          pendingTricks: [{ name: '闪电', source: 0, card }],
          health: 4,
        }),
        makePlayer({ index: 1, name: 'P2', hand: ['wx1'], skills: ['无懈可击', '闪电', '回合管理'], health: 4 }),
      ],
      cardMap: { sd1: card, j1: judgeCard, wx1: nullifCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    // 触发判定阶段 → 先问无懈(不超时,改打无懈)
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    // P2 打出无懈可击抵消闪电
    await harness.player('P2').respond('无懈可击', { cardId: 'wx1' });
    // 无懈 respond 会重启窗口(等待反无懈),需再消耗
    await waitForStable(harness.state);
    if (harness.state.pendingSlots.size > 0) {
      await fireTimeoutAndWait(harness.state); // 消耗反无懈窗口
    }

    // 闪电被抵消:P0 不受伤(黑桃5 未判定)、判定牌未被翻动(仍在 deck)
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.zones.deck).toContain('j1');
    // 闪电已从判定区移除
    expect(harness.state.players[0].pendingTricks.length).toBe(0);
    // 无懈牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wx1');
    // 无传递给 P2
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
  });
});
