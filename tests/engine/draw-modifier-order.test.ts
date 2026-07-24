// tests/engine/draw-modifier-order.test.ts
// 模块 L:摸牌 before-hook 按 ownerId 逆时针排列(当前回合角色起)。
//
// 验证:
//   1. applyAtom 仅对 '摸牌' 类型按座次逆时针(当前回合角色起)排序 before-hook。
//   2. 系统级 hook(ownerId<0,如 TARGET_SYSTEM=-1)排最前。
//   3. modify 叠加对纯加减法保持交换律(英姿+1 / 裸衣-1 类比:结果与顺序无关)。
//   4. 单 before-hook 走快速路径不报错。
//   5. 非 '摸牌' atom 的 before-hook 顺序不变(维持注册序)。
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { registerBeforeHook } from '../../src/engine/skill';
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

/** 记录型 before-hook:把 ownerId 追加到 localVars['__order']。 */
function recordDrawHook(state: GameState, ownerId: number): () => void {
  return registerBeforeHook(state, `观察${ownerId}`, ownerId, '摸牌', async (ctx) => {
    const arr = (ctx.state.localVars['__order'] as number[] | undefined) ?? [];
    arr.push(ownerId);
    ctx.state.localVars['__order'] = arr;
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

describe('模块 L:摸牌 before-hook 逆时针排序', () => {
  // ─── 1. 按逆时针(当前回合角色起)执行 ────────────────────
  it('currentPlayer=0:hooks(ownerId 2,0,3) 按 [0,2,3] 逆时针执行', async () => {
    const s = makeState(4, 0);
    // 故意以乱序注册
    recordDrawHook(s, 2);
    recordDrawHook(s, 0);
    recordDrawHook(s, 3);
    await applyAtom(s, { type: '摸牌', player: 0, count: 1 });
    expect(s.localVars['__order']).toEqual([0, 2, 3]);
  });

  // ─── 2. 非 0 起点:modular arithmetic 正确(逆时针绕回)─────
  it('currentPlayer=2:hooks(ownerId 0,3,2) 按 [2,3,0] 逆时针执行', async () => {
    const s = makeState(4, 2);
    recordDrawHook(s, 0);
    recordDrawHook(s, 3);
    recordDrawHook(s, 2);
    await applyAtom(s, { type: '摸牌', player: 2, count: 1 });
    expect(s.localVars['__order']).toEqual([2, 3, 0]);
  });

  // ─── 3. 系统级 hook(ownerId<0)排最前 ───────────────────
  it('系统级 hook(ownerId=-1)排在最前', async () => {
    const s = makeState(4, 1);
    recordDrawHook(s, 3);
    recordDrawHook(s, -1);
    recordDrawHook(s, 1);
    await applyAtom(s, { type: '摸牌', player: 1, count: 1 });
    // currentPlayer=1 逆时针:1(dist 0)→2(1)→3(2)→0(3);-1 系统级排最前
    expect(s.localVars['__order']).toEqual([-1, 1, 3]);
  });

  // ─── 4. 单 hook 走快速路径(hooks.length>1 才排序)─────────
  it('仅一个 before-hook 时仍正常执行', async () => {
    const s = makeState(2, 0);
    recordDrawHook(s, 1);
    await applyAtom(s, { type: '摸牌', player: 0, count: 1 });
    expect(s.localVars['__order']).toEqual([1]);
  });

  // ─── 5. modify 叠加交换律:+1 与 -1 结果与顺序无关 ─────────
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

  // ─── 6. 多个正修正叠加:类比 英姿+1 + 好施+2 = +3 ──────────
  it('modify 多正修正叠加:+1 与 +2 后摸 5 张(基础2+3)', async () => {
    const s = makeState(3, 0);
    modifyDrawHook(s, 2, +2); // 类比好施
    modifyDrawHook(s, 1, +1); // 类比英姿
    await applyAtom(s, { type: '摸牌', player: 0, count: 2 });
    expect(s.players[0].hand.length).toBe(5);
  });
});

describe('模块 L:非摸牌 atom 不受排序影响', () => {
  // ─── 7. 其他 atom 维持注册序(回归保护)──────────────────
  it('非摸牌 atom(设阶段)before-hook 维持注册顺序', async () => {
    const s = makeState(4, 0);
    // 在 设阶段 上注册观察 hook(故意乱序)
    for (const oid of [2, 0, 3]) {
      registerBeforeHook(s, `阶段观察${oid}`, oid, '设阶段', async (ctx) => {
        const arr = (ctx.state.localVars['__phaseOrder'] as number[] | undefined) ?? [];
        arr.push(oid);
        ctx.state.localVars['__phaseOrder'] = arr;
      });
    }
    await applyAtom(s, { type: '设阶段', phase: '摸牌' });
    // 设阶段 不排序 → 维持注册序 [2,0,3]
    expect(s.localVars['__phaseOrder']).toEqual([2, 0, 3]);
  });
});
