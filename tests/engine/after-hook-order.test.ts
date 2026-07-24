// tests/engine/after-hook-order.test.ts
// 模块 P:伤害结算结束后 after-hook 按 ownerId 逆时针排列(当前回合角色起)。
//
// 验证(对齐 docs/flow-redesign.md 模块 P):
//   1. runAfterHooks 仅对 '伤害结算结束后' 类型按座次逆时针(当前回合角色起)排序 after-hook。
//   2. 系统级 hook(ownerId<0,如连环传导)排最前。
//   3. 单 after-hook 走快速路径不报错(hooks.length>1 才排序)。
//   4. 其他 atom 的 after-hook 顺序不变(维持"系统级排最后"+注册序)。
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms'; // 注册所有 atom(含 damage-timing)
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { registerAfterHook } from '../../src/engine/skill';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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

/** 构造 N 玩家 state。after-hook 测试不涉及摸牌/出牌,无需牌堆。 */
function makeState(playerCount: number, currentPlayerIndex: number): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => makePlayer(i));
  return createGameState({
    players,
    cardMap: {},
    currentPlayerIndex,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

/** 记录型 after-hook:把 ownerId 追加到 localVars['__order']。 */
function recordAfterHook(state: GameState, ownerId: number): () => void {
  return registerAfterHook(state, `观察${ownerId}`, ownerId, '伤害结算结束后', async (ctx) => {
    const arr = (ctx.state.localVars['__order'] as number[] | undefined) ?? [];
    arr.push(ownerId);
    ctx.state.localVars['__order'] = arr;
  });
}

/** 触发一次 伤害结算结束后 atom(标记型,无副作用,仅跑 after-hook)。 */
function fireAfterHooks(state: GameState): Promise<boolean> {
  return applyAtom(state, {
    type: '伤害结算结束后',
    source: state.currentPlayerIndex,
    target: 0,
    amount: 1,
  });
}

describe('模块 P:伤害结算结束后 after-hook 逆时针排序', () => {
  // ─── 1. 按逆时针(当前回合角色起)执行 ────────────────────
  it('currentPlayer=0:hooks(ownerId 2,0,3) 按 [0,2,3] 逆时针执行', async () => {
    const s = makeState(4, 0);
    // 故意以乱序注册
    recordAfterHook(s, 2);
    recordAfterHook(s, 0);
    recordAfterHook(s, 3);
    await fireAfterHooks(s);
    expect(s.localVars['__order']).toEqual([0, 2, 3]);
  });

  // ─── 2. 非 0 起点:modular arithmetic 正确(逆时针绕回)─────
  it('currentPlayer=2:hooks(ownerId 0,3,2) 按 [2,3,0] 逆时针执行', async () => {
    const s = makeState(4, 2);
    recordAfterHook(s, 0);
    recordAfterHook(s, 3);
    recordAfterHook(s, 2);
    await fireAfterHooks(s);
    expect(s.localVars['__order']).toEqual([2, 3, 0]);
  });

  // ─── 3. 系统级 hook(ownerId<0)排最前 ───────────────────
  it('系统级 hook(ownerId=-1,类比连环传导)排在最前', async () => {
    const s = makeState(4, 1);
    recordAfterHook(s, 3);
    recordAfterHook(s, -1); // 系统级(连环传导 hook 注册时 ownerId=-1)
    recordAfterHook(s, 1);
    await fireAfterHooks(s);
    // currentPlayer=1 逆时针:1(dist 0)→3(dist 2);-1 系统级排最前
    expect(s.localVars['__order']).toEqual([-1, 1, 3]);
  });

  // ─── 4. 单 hook 走快速路径(hooks.length>1 才排序)─────────
  it('仅一个 after-hook 时仍正常执行', async () => {
    const s = makeState(2, 0);
    recordAfterHook(s, 1);
    await fireAfterHooks(s);
    expect(s.localVars['__order']).toEqual([1]);
  });

  // ─── 5. 系统级 + 全员:完整逆时针序列 ────────────────────
  it('currentPlayer=1:系统+0,1,2,3 按 [-1,1,2,3,0] 逆时针执行', async () => {
    const s = makeState(4, 1);
    // 乱序注册:3,0,-1,2,1
    recordAfterHook(s, 3);
    recordAfterHook(s, 0);
    recordAfterHook(s, -1);
    recordAfterHook(s, 2);
    recordAfterHook(s, 1);
    await fireAfterHooks(s);
    // 系统(-1)最前;然后从 cur=1 起逆时针:1,2,3,0
    expect(s.localVars['__order']).toEqual([-1, 1, 2, 3, 0]);
  });
});

describe('模块 P:其他 atom 的 after-hook 不受排序影响', () => {
  // ─── 6. 非 伤害结算结束后 atom 维持"系统级排最后"+注册序(回归保护)─
  it('受到伤害后 after-hook 维持系统级排最后+注册序', async () => {
    const s = makeState(4, 1);
    // 在 受到伤害后 上注册观察 hook(故意乱序)
    for (const oid of [3, -1, 0]) {
      registerAfterHook(s, `伤害观察${oid}`, oid, '受到伤害后', async (ctx) => {
        const arr = (ctx.state.localVars['__sufferOrder'] as number[] | undefined) ?? [];
        arr.push(oid);
        ctx.state.localVars['__sufferOrder'] = arr;
      });
    }
    await applyAtom(s, { type: '受到伤害后', source: 1, target: 0, amount: 1 });
    // 非 CLOCKWISE 类型:系统级(ownerId=-1)排最后,其余维持注册序 [3,0]
    expect(s.localVars['__sufferOrder']).toEqual([3, 0, -1]);
  });
});
