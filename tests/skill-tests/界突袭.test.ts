// tests/skill-tests/界突袭.test.ts
// 界突袭(界张辽·摸牌阶段弹性替换技)测试:
//   OL 官方:"摸牌阶段,你可以少摸任意张牌并获得等量其他角色的各一张手牌。"
//
// 与标版突袭核心差异:
//   - 标版:放弃摸牌(全或无),获得至多 2 名角色各一张手牌
//   - 界版:弹性少摸任意张(1~摸牌数),获得等量其他角色各一张手牌,剩余照常摸
//
// 验证:
//   1. 发动 + 选 2 人 → 各偷一张手牌 + 不摸牌(N=2 完全少摸)
//   2. 发动 + 选 1 人 → 获得 1 张手牌 + 摸 1 张(N=1 部分少摸,界版独有弹性)
//   3. 不发动 → 默认摸 2 张
//   4. 无有效目标(其他角色都无手牌)→ 不询问,默认摸 2 张
//   5. respond:无 pending → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import { applyAtom } from '../../src/engine/create-engine';
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
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界张辽',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界突袭', '回合管理'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: '魏',
    identity: '主公',
  };
}

describe('界突袭', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 发动 + 选 2 人 → 各偷一张 + 不摸牌(N=2 完全少摸) ───────
  it('发动 + 选 P1/P2 → 各获得一张手牌,本次不摸牌(N=2 完全少摸)', async () => {
    const c1 = makeCard('a1', '杀', '♠', '7');
    const c2 = makeCard('a2', '闪', '♥', '5');
    const c3 = makeCard('a3', '桃', '♦', '3');
    const c4 = makeCard('a4', '酒', '♣', '9');
    // 牌堆保留 2 张(用于验证完全少摸 → 这两张不应被摸入)
    const d1 = makeCard('d1', '杀', '♠', '2');
    const d2 = makeCard('d2', '闪', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界突袭', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['a1', 'a2'], skills: ['回合管理'] }),
        makePlayer({ index: 2, name: 'P2', hand: ['a3', 'a4'], skills: ['回合管理'] }),
      ],
      cardMap: { a1: c1, a2: c2, a3: c3, a4: c4, d1, d2 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 触发阶段推进:判定阶段结束 → 回合管理 → 摸牌阶段开始 → 摸牌 atom → 界突袭 hook
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '判定' });
    await waitForStable(harness.state); // 界突袭/trigger 询问
    P0.expectPending('请求回应');
    await P0.respond('界突袭', { choice: true }); // 发动
    await waitForStable(harness.state); // 界突袭/select 询问
    await P0.respond('界突袭', { targets: [1, 2] });
    await harness.waitForStable();

    // P0 各从 P1/P2 拿一张(共 2 张),未从牌堆摸牌(牌堆 d1/d2 未动)
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[1].hand.length).toBe(1);
    expect(harness.state.players[2].hand.length).toBe(1);
    // 牌堆仍为 2 张(完全少摸 → 未触发摸牌)
    expect(harness.state.zones.deck.length).toBe(2);
    // P0 拿到的牌来自 P1/P2 的手牌池
    const pool = new Set(['a1', 'a2', 'a3', 'a4']);
    for (const id of harness.state.players[0].hand) expect(pool.has(id)).toBe(true);
    // 拿到的牌不再属于原主
    for (const id of harness.state.players[0].hand) {
      expect(harness.state.players[1].hand).not.toContain(id);
      expect(harness.state.players[2].hand).not.toContain(id);
    }
  });

  // ─── 2. 发动 + 选 1 人 → 获得 1 张 + 摸 1 张(N=1 部分少摸,界版独有弹性) ───
  it('发动 + 选 P1 → 获得 P1 一张手牌 + 摸 1 张(N=1 部分少摸)', async () => {
    const c1 = makeCard('a1', '杀', '♠', '7');
    const c2 = makeCard('a2', '闪', '♥', '5');
    const d1 = makeCard('d1', '桃', '♦', '2');
    const d2 = makeCard('d2', '酒', '♣', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界突袭', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['a1', 'a2'], skills: ['回合管理'] }),
        makePlayer({ index: 2, name: 'P2', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { a1: c1, a2: c2, d1, d2 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '判定' });
    await waitForStable(harness.state); // trigger 询问
    P0.expectPending('请求回应');
    await P0.respond('界突袭', { choice: true }); // 发动
    await waitForStable(harness.state); // select 询问
    await P0.respond('界突袭', { targets: [1] }); // 只选 1 人
    await harness.waitForStable();

    // P0 获得 P1 一张手牌(共 1 张来自偷)+ 摸 1 张(来自牌堆)= 共 2 张
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[1].hand.length).toBe(1); // P1 被偷一张
    // 牌堆消耗 1 张(N=1 部分少摸 → 摸 2-1=1 张)
    expect(harness.state.zones.deck.length).toBe(1);
    // 拿到的牌中一张来自 P1 的手牌池,一张来自牌堆(d1 或 d2)
    const stolenFromP1 = harness.state.players[0].hand.filter((id) => id === 'a1' || id === 'a2');
    const drawnFromDeck = harness.state.players[0].hand.filter((id) => id === 'd1' || id === 'd2');
    expect(stolenFromP1.length).toBe(1);
    expect(drawnFromDeck.length).toBe(1);
  });

  // ─── 3. 不发动 → 默认摸 2 张 ─────────────────────────────
  it('不发动 → 走默认摸牌(P0 手牌+2,从牌堆摸)', async () => {
    const d1 = makeCard('d1', '杀');
    const d2 = makeCard('d2', '闪', '♥');
    const c1 = makeCard('a1', '桃', '♦');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界突袭', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', hand: ['a1'], skills: ['回合管理'] }),
      ],
      cardMap: { d1, d2, a1: c1 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '判定' });
    await waitForStable(harness.state);
    P0.expectPending('请求回应');
    await P0.respond('界突袭', { choice: false }); // 不发动
    await harness.waitForStable();

    // 默认摸了 2 张(从牌堆 d1/d2)
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(new Set(harness.state.players[0].hand)).toEqual(new Set(['d1', 'd2']));
    // P1 手牌未受影响(未被偷)
    expect(harness.state.players[1].hand).toEqual(['a1']);
    // 牌堆耗尽
    expect(harness.state.zones.deck.length).toBe(0);
  });

  // ─── 4. 无有效目标 → 不询问,默认摸牌 ─────────────────────────────
  it('其他角色都无手牌 → 界突袭不触发,默认摸 2 张', async () => {
    const d1 = makeCard('d1', '杀');
    const d2 = makeCard('d2', '闪', '♥');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界突袭', '回合管理'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['回合管理'] }),
      ],
      cardMap: { d1, d2 },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['d1', 'd2'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '判定' });
    await harness.waitForStable();

    // 无目标 → 不询问界突袭 → 直接默认摸牌
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(new Set(harness.state.players[0].hand)).toEqual(new Set(['d1', 'd2']));
    expect(harness.state.zones.deck.length).toBe(0);
  });

  // ─── 5. respond validate:无 pending 拒绝 ─────────────────────────────
  it('respond:无 pending → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界突袭'] }),
        makePlayer({ index: 1, name: 'P1', skills: [] }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    await P0.expectRejected({ skillId: '界突袭', actionType: 'respond', params: { choice: true } });
  });
});
