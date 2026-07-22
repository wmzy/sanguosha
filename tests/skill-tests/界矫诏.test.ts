// 界矫诏(界郭皇后·转化技)测试:
// 核心规则(OL 界限突破官方逐字):
//   出牌阶段限一次,你可将一张牌当本轮未有角色使用过的基本或普通锦囊牌使用。
//
// 用例:
//   1. 正面:转化杀并出杀 → P2 受伤
//   2. 正面:转化无中生有并使用 → 摸两张牌
//   3. 正面:转化顺手牵羊并使用 → 牵走 P2 一张牌
//   4. 限一次:本回合第二次转化被拒绝
//   5. 本轮已用:某牌名已被使用(任何玩家)→ 转化为该牌名被拒绝
//   6. 边界:outputName 非基本/普通锦囊(装备/延时/响应锦囊)→ 拒绝
//   7. 边界:非自己回合 → 拒绝
//   8. 边界:非出牌阶段 → 拒绝
//   9. 边界:原牌不在手牌 → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  return { id, name, suit, color, rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界郭皇后',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    // 默认包含主技能 + 基本牌/闪技能(以便转化目标能结算)
    skills: opts.skills ?? ['界矫诏', '杀', '闪', '桃'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

const USED_KEY = '界矫诏/usedThisTurn';
const USED_NAMES_KEY = '界矫诏/已用牌名';

function usedThisTurn(state: GameState, ownerId: number): boolean {
  return !!state.players[ownerId]?.vars[USED_KEY];
}

function usedNames(state: GameState): string[] {
  const v = state.localVars[USED_NAMES_KEY];
  return Array.isArray(v) ? (v as string[]) : [];
}

describe('界矫诏', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:转化杀 → P2 受伤 ─────────────────────────────
  it('transformThenUse:杀牌(源)→杀(目标),P2 受 1 伤', async () => {
    const src = makeCard('c1', '杀', '♠', '7'); // 任意源牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: src },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // 转化:c1 → 杀(影子 id=c1#界矫诏);preceding + 杀.use
    await P0.transformThenUse(
      '界矫诏',
      { cardId: 'c1', outputName: '杀' },
      '杀',
      { cardId: 'c1#界矫诏', targets: [1] },
    );
    // P1 不闪
    await P1.pass();

    expect(harness.state.players[1].health).toBe(2); // 受 1 伤(初始 3)
    expect(usedThisTurn(harness.state, 0)).toBe(true);
    // 影子杀已入弃牌堆;原 c1 仍存于 cardMap(shadowOf 还原机制)
    expect(harness.state.cardMap['c1']).toBeDefined();
  });

  // ─── 2. 正面:转化无中生有 → 摸两张牌 ─────────────────────────
  it('transformThenUse:杀牌→无中生有,自己摸两张牌', async () => {
    const src = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['界矫诏', '杀', '闪', '桃', '无中生有'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: src },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length;
    await P0.transformThenUse(
      '界矫诏',
      { cardId: 'c1', outputName: '无中生有' },
      '无中生有',
      { cardId: 'c1#界矫诏' },
    );
    // 询问无懈可击:P1 pass(无无懈可击 → 不抵消 → 摸两张)
    await P1.pass();

    const handAfter = harness.state.players[0].hand.length;
    expect(handAfter - handBefore).toBe(1); // 用了 1 张(c1)+ 摸 2 = +1 净
    expect(usedThisTurn(harness.state, 0)).toBe(true);
  });

  // ─── 3. 限一次:本回合第二次转化被拒绝 ─────────────────────
  it('限一次:本回合第二次 transform 被拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', '7');
    const c2 = makeCard('c2', '杀', '♠', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1', 'c2'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1, c2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 第一次:转化杀 + 出杀(P1 不闪)
    await P0.transformThenUse(
      '界矫诏',
      { cardId: 'c1', outputName: '杀' },
      '杀',
      { cardId: 'c1#界矫诏', targets: [1] },
    );
    await harness.player('P1').pass();
    expect(usedThisTurn(harness.state, 0)).toBe(true);

    // 第二次:再次 transform → 拒绝(限一次)
    await P0.expectRejected({
      skillId: '界矫诏',
      actionType: 'transform',
      params: { cardId: 'c2', outputName: '无中生有' },
    });
  });

  // ─── 4. 本轮已用:P0 先出杀 → 矫诏转化杀被拒绝(同一玩家、同一轮) ───
  it('本轮已用:P0 先出杀(使用过)→ 矫诏转化杀被拒(跨玩家追踪)', async () => {
    const p0杀 = makeCard('c0', '杀', '♠', '5');
    const p0源 = makeCard('c2', '闪', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c0', 'c2'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操', hand: [], skills: ['闪'] }),
      ],
      cardMap: { c0: p0杀, c2: p0源 },
      currentPlayerIndex: 0, // P0 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 出杀(c0)→ P1 不闪
    await P0.triggerAction('杀', 'use', { cardId: 'c0', targets: [1] });
    await P1.pass();
    expect(harness.state.players[1].health).toBe(2); // P1 受 1 伤

    // 此时"杀"已被 P0 使用,本轮已用牌名集合应含"杀"
    expect(usedNames(harness.state)).toContain('杀');

    // P0 矫诏转化杀 → 拒绝(本轮已有角色使用过杀)
    await P0.expectRejected({
      skillId: '界矫诏',
      actionType: 'transform',
      params: { cardId: 'c2', outputName: '杀' },
    });
  });

  // ─── 5. 边界:outputName 非基本/普通锦囊 → 拒绝 ─────────────────
  it('outputName=无懈可击(响应锦囊)→ 拒绝', async () => {
    const src = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: src },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界矫诏',
      actionType: 'transform',
      params: { cardId: 'c1', outputName: '无懈可击' },
    });
  });

  // ─── 6. 边界:outputName 不存在 → 拒绝 ─────────────────────
  it('outputName=不存在的牌名 → 拒绝', async () => {
    const src = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: src },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界矫诏',
      actionType: 'transform',
      params: { cardId: 'c1', outputName: '不存在牌名' },
    });
  });

  // ─── 7. 边界:非自己回合 → 拒绝 ─────────────────────────
  it('非自己回合 → 拒绝', async () => {
    const src = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: src },
      currentPlayerIndex: 1, // P1 回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界矫诏',
      actionType: 'transform',
      params: { cardId: 'c1', outputName: '杀' },
    });
  });

  // ─── 8. 边界:非出牌阶段 → 拒绝 ────────────────────────
  it('非出牌阶段 → 拒绝', async () => {
    const src = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: src },
      currentPlayerIndex: 0,
      phase: '摸牌', // 不是出牌
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界矫诏',
      actionType: 'transform',
      params: { cardId: 'c1', outputName: '杀' },
    });
  });

  // ─── 9. 边界:原牌不在手牌 → 拒绝 ──────────────────────
  it('原牌不在手牌 → 拒绝', async () => {
    const src = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操', hand: ['c1'] }),
      ],
      cardMap: { c1: src },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '界矫诏',
      actionType: 'transform',
      params: { cardId: 'c1', outputName: '杀' },
    });
  });

  // ─── 10. 已用牌名追踪:转化后,本轮该牌名被记录 ────────────────
  it('追踪:矫诏转化后,该牌名被记入本轮已用集合', async () => {
    const src = makeCard('c1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['c1'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { c1: src },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    expect(usedNames(harness.state)).not.toContain('杀');

    await P0.transformThenUse(
      '界矫诏',
      { cardId: 'c1', outputName: '杀' },
      '杀',
      { cardId: 'c1#界矫诏', targets: [1] },
    );
    await harness.player('P1').pass();

    // 杀已通过矫诏转化使用 → 记入本轮已用集合
    expect(usedNames(harness.state)).toContain('杀');
  });
});
