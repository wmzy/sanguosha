// tests/skill-tests/rank-flow.test.ts
// 模块 G:拼点两步化编排函数 runRankCompareFlow 验证(对齐 docs/flow-redesign.md 模块 G / rankcompare.md)。
// 不依赖具体技能——直接调用编排函数,断言 state.atomHistory 的 atom 时序、面朝下信息分级、
// 点数比较结果与 state.zones 的实质变化。
//
// 验证点(对齐 docs/flow-redesign.md 模块 G 验收):
//   1. 三时机依次发出:拼点扣置 → 拼点亮出 → 拼点后(尾随两张 移动牌 入弃牌堆)
//   2. 面朝下:拼点扣置 toViewEvents 对非扣置者隐藏牌面(发起方只看到自己的牌,目标方只看到自己的)
//   3. 拼点亮出:向全员公开两张牌面
//   4. 点数相同 → 没赢
//   5. 发起方点数大 → 赢;结果正确返回给调用方
//   6. 牌最终入弃牌堆(双方手牌各 -1)
//   7. 旧 拼点 atom 仍兼容(未迁移调用方)
import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/engine/atoms'; // 注册所有 atom(含 rank-timing)
import { createGameState } from '../../src/engine/types';
import type { Atom, Card, GameState, PlayerState, ViewEventSplit } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { runRankCompareFlow, getCardValue } from '../../src/engine/rank-flow';
import { applyAtom } from '../../src/engine/create-engine';
import { getAtomDef } from '../../src/engine/atom';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank: string,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

function makeState(): GameState {
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P0', health: 4, maxHealth: 4 }),
      makePlayer({ index: 1, name: 'P1', health: 4, maxHealth: 4 }),
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

/** 取 state.atomHistory 中所有 atom 事件(跳过 notify)的 type 序列。 */
function atomTypes(state: GameState): string[] {
  return state.atomHistory
    .filter((e) => e.kind === 'atom')
    .map((e) => (e as { atom: Atom }).atom.type);
}

describe('模块 G:拼点两步化 runRankCompareFlow', () => {
  let state: GameState;
  beforeEach(() => {
    state = makeState();
  });

  // ── 时机顺序 ───────────────────────────────────────────────
  it('三时机依次发出:拼点扣置 → 拼点亮出 → 拼点后,尾随两张 移动牌 入弃牌堆', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    state.players[0].hand = ['c1'];
    state.players[1].hand = ['c2'];
    state.cardMap = { c1, c2 };

    await runRankCompareFlow(state, 0, 1, 'c1', 'c2');

    expect(atomTypes(state)).toEqual([
      '拼点扣置',
      '拼点亮出',
      '移动牌', // initiatorCard 处理区→弃牌堆
      '移动牌', // targetCard 处理区→弃牌堆
      '拼点后', // 两张牌已入弃牌堆后发出(钩子读 discardPile)
    ]);
  });

  // ── 面朝下:非扣置者看不到牌面 ──────────────────────────────
  it('拼点扣置 toViewEvents:发起方只看到自己的牌面,目标方只看到自己的,其他人两张都看不到', () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    state.players[0].hand = ['c1'];
    state.players[1].hand = ['c2'];
    state.cardMap = { c1, c2 };

    const atom = { type: '拼点扣置', initiator: 0, target: 1, initiatorCard: 'c1', targetCard: 'c2' } as Atom;
    const def = getAtomDef('拼点扣置');
    const split = def.toViewEvents!(state, atom) as ViewEventSplit;

    // 发起方视图:有 initiatorCardFace,无 targetCardFace
    const initiatorView = split.ownerViews.get(0);
    expect(initiatorView).toBeDefined();
    expect(initiatorView!.initiatorCardFace).toEqual({ name: '杀', suit: '♠', rank: 'K' });
    expect(initiatorView!.targetCardFace).toBeUndefined();

    // 目标方视图:有 targetCardFace,无 initiatorCardFace
    const targetView = split.ownerViews.get(1);
    expect(targetView).toBeDefined();
    expect(targetView!.targetCardFace).toEqual({ name: '闪', suit: '♥', rank: '2' });
    expect(targetView!.initiatorCardFace).toBeUndefined();

    // 其他人视图:两张牌面都看不到
    const othersView = split.othersView;
    expect(othersView).toBeDefined();
    expect(othersView!.initiatorCardFace).toBeUndefined();
    expect(othersView!.targetCardFace).toBeUndefined();
    // 但 cardId 仍下发(供 applyView 同步处理区/手牌数)
    expect(othersView!.initiatorCard).toBe('c1');
    expect(othersView!.targetCard).toBe('c2');
  });

  // ── 拼点亮出:公开牌面 ─────────────────────────────────────
  it('拼点亮出 toViewEvents:向全员公开两张牌面', () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    state.players[0].hand = ['c1'];
    state.players[1].hand = ['c2'];
    state.cardMap = { c1, c2 };

    const atom = { type: '拼点亮出', initiator: 0, target: 1, initiatorCard: 'c1', targetCard: 'c2' } as Atom;
    const def = getAtomDef('拼点亮出');
    const split = def.toViewEvents!(state, atom) as ViewEventSplit;

    // ownerViews 为空 → 所有人走 othersView(全员公开)
    expect(split.ownerViews.size).toBe(0);
    const view = split.othersView;
    expect(view).toBeDefined();
    expect(view!.initiatorCardFace).toEqual({ name: '杀', suit: '♠', rank: 'K' });
    expect(view!.targetCardFace).toEqual({ name: '闪', suit: '♥', rank: '2' });
  });

  // ── 点数相同 → 没赢 ────────────────────────────────────────
  it('点数相同(平局)→ 没赢', async () => {
    const c1 = makeCard('c1', '杀', '♠', '7');
    const c2 = makeCard('c2', '闪', '♥', '7');
    state.players[0].hand = ['c1'];
    state.players[1].hand = ['c2'];
    state.cardMap = { c1, c2 };

    const result = await runRankCompareFlow(state, 0, 1, 'c1', 'c2');
    expect(result).toBe('没赢');
    // 拼点后 atom 携带 result='没赢'
    const afterAtom = atomTypes(state).includes('拼点后');
    expect(afterAtom).toBe(true);
  });

  // ── 发起方点数大 → 赢 ──────────────────────────────────────
  it('发起方点数大(K>2)→ 赢,结果正确返回', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    state.players[0].hand = ['c1'];
    state.players[1].hand = ['c2'];
    state.cardMap = { c1, c2 };

    const result = await runRankCompareFlow(state, 0, 1, 'c1', 'c2');
    expect(result).toBe('赢');
  });

  // ── 发起方点数小 → 没赢 ────────────────────────────────────
  it('发起方点数小(2<K)→ 没赢', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '闪', '♥', 'K');
    state.players[0].hand = ['c1'];
    state.players[1].hand = ['c2'];
    state.cardMap = { c1, c2 };

    const result = await runRankCompareFlow(state, 0, 1, 'c1', 'c2');
    expect(result).toBe('没赢');
  });

  // ── 牌入弃牌堆(实质状态变化)──────────────────────────────
  it('拼点后两张拼点牌入弃牌堆,双方手牌各 -1', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    state.players[0].hand = ['c1'];
    state.players[1].hand = ['c2'];
    state.cardMap = { c1, c2 };

    await runRankCompareFlow(state, 0, 1, 'c1', 'c2');

    // 双方手牌清空
    expect(state.players[0].hand).toEqual([]);
    expect(state.players[1].hand).toEqual([]);
    // 两张牌入弃牌堆
    expect(state.zones.discardPile).toContain('c1');
    expect(state.zones.discardPile).toContain('c2');
    // 处理区不留牌
    expect(state.zones.processing).toEqual([]);
  });

  // ── getCardValue 点数计算 ──────────────────────────────────
  it('getCardValue:A=1, 2-10=面值, J=11, Q=12, K=13', () => {
    expect(getCardValue(makeCard('a', '杀', '♠', 'A'))).toBe(1);
    expect(getCardValue(makeCard('b', '杀', '♠', '5'))).toBe(5);
    expect(getCardValue(makeCard('c', '杀', '♠', '10'))).toBe(10);
    expect(getCardValue(makeCard('d', '杀', '♠', 'J'))).toBe(11);
    expect(getCardValue(makeCard('e', '杀', '♠', 'Q'))).toBe(12);
    expect(getCardValue(makeCard('f', '杀', '♠', 'K'))).toBe(13);
    expect(getCardValue(undefined)).toBe(0);
  });

  // ── 旧 拼点 atom 仍兼容(未迁移调用方)──────────────────────
  it('旧 拼点 atom 未被修改,仍可独立 apply(把处理区牌移入弃牌堆)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    // 旧 拼点 atom 约定:两张牌已在处理区(frame.cards / processing)
    state.zones.processing = ['c1', 'c2'];
    state.cardMap = { c1, c2 };

    await applyAtom(state, {
      type: '拼点',
      initiator: 0,
      target: 1,
      initiatorCard: 'c1',
      targetCard: 'c2',
    });

    // 旧 atom 把两张牌移入弃牌堆
    expect(state.zones.processing).toEqual([]);
    expect(state.zones.discardPile).toContain('c1');
    expect(state.zones.discardPile).toContain('c2');
  });

  // ── 拼点后 atom 携带正确 result ────────────────────────────
  it('拼点后 atom 携带 result 字段(赢/没赢)', async () => {
    const c1 = makeCard('c1', '杀', '♠', 'K');
    const c2 = makeCard('c2', '闪', '♥', '2');
    state.players[0].hand = ['c1'];
    state.players[1].hand = ['c2'];
    state.cardMap = { c1, c2 };

    await runRankCompareFlow(state, 0, 1, 'c1', 'c2');
    const afterAtom = state.atomHistory
      .filter((e) => e.kind === 'atom')
      .map((e) => (e as { atom: Atom }).atom)
      .find((a) => a.type === '拼点后') as Extract<Atom, { type: '拼点后' }> | undefined;
    expect(afterAtom).toBeDefined();
    expect(afterAtom!.result).toBe('赢');
  });
});
