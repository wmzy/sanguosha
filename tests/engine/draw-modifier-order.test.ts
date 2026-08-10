// tests/engine/draw-modifier-order.test.ts
// 摸牌修饰器(draw modifier)叠加语义。
//
// 逆时针排序用例(基础序、modular 绕回、系统级排尾、单 hook 快速路径、泛化到其他
// atom)已归并至 after-hook-order.test.ts——排序由共享私有函数
// sortHooksCounterclockwise 完成,before-hook 与 after-hook 走同一实现,排序主题
// 以 after-hook-order 为归属。本文件只保留摸牌 before-hook 的 modify 叠加行为:
//   1. modify 叠加对纯加减法保持交换律(英姿+1 / 裸衣-1 类比:结果与顺序无关)。
//   2. 多个正修正叠加(英姿+1 + 好施+2 = +3)。
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import { registerBeforeHook } from '../../src/engine/core/skill';
import type { Card, GameState, PlayerState, HookResult } from '../../src/engine/types';

function makeCard(id: string): Card {
  return { id, name: '测试牌', suit: '♠', color: '黑', rank: '1', type: '基本牌' };
}

function makePlayer(index: number): PlayerState {
  return {
    index,
    name: `P${index}`,
    character: '测试',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [],
    equipment: {},
    pendingTricks: [],
    skills: [],
    vars: {},
    marks: [],
    tags: [],
  };
}

/** 构造 N 玩家 state,牌堆预置足够牌供摸牌。 */
function makeState(playerCount: number, currentPlayerIndex: number): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => makePlayer(i));
  const deck = Array.from({ length: 30 }, (_, i) => `c${i}`);
  const cardMap: Record<string, Card> = {};
  for (const id of deck) cardMap[id] = makeCard(id);
  return createGameState({
    players,
    cardMap,
    zones: { deck, discardPile: [], processing: [] },
    currentPlayerIndex,
    phase: '摸牌',
    turn: { round: 1, phase: '摸牌', vars: {} },
  });
}

/** modify 型 before-hook:把摸牌 count 叠加 delta。 */
function modifyDrawHook(state: GameState, ownerId: number, delta: number): () => void {
  return registerBeforeHook(state, `修正${ownerId}`, ownerId, '摸牌', async (ctx) => {
    const atom = ctx.atom as { player: number; count: number };
    return {
      kind: 'modify',
      atom: { ...atom, count: atom.count + delta },
    } as HookResult;
  });
}

describe('摸牌修饰器叠加(modify)', () => {
  // ─── 1. modify 叠加交换律:+1 与 -1 结果与顺序无关 ─────────
  //   类比 英姿(+1) 与 裸衣(-1):无论注册顺序如何,基础 2 +1 -1 = 2 张
  it('modify 叠加交换律:+1 与 -1 叠加后摸 2 张(与 ownerId 顺序无关)', async () => {
    const sA = makeState(3, 0);
    modifyDrawHook(sA, 1, +1); // 类比英姿:seat 1
    modifyDrawHook(sA, 2, -1); // 类比裸衣:seat 2
    await applyAtom(sA, { type: '摸牌', player: 0, count: 2 });
    // player 0 起始 0 手牌,摸 2(+1-1=0 修正)
    expect(sA.players[0].hand.length).toBe(2);

    // 反转注册顺序,结果不变(交换律)
    const sB = makeState(3, 0);
    modifyDrawHook(sB, 2, -1);
    modifyDrawHook(sB, 1, +1);
    await applyAtom(sB, { type: '摸牌', player: 0, count: 2 });
    expect(sB.players[0].hand.length).toBe(2);
  });

  // ─── 2. 多个正修正叠加:类比 英姿+1 + 好施+2 = +3 ──────────
  it('modify 多正修正叠加:+1 与 +2 后摸 5 张(基础2+3)', async () => {
    const s = makeState(3, 0);
    modifyDrawHook(s, 2, +2); // 类比好施
    modifyDrawHook(s, 1, +1); // 类比英姿
    await applyAtom(s, { type: '摸牌', player: 0, count: 2 });
    expect(s.players[0].hand.length).toBe(5);
  });
});
