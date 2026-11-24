// tests/engine/sync-timing-contract.test.ts
// 零挂起时序契约:applyAtom 在「无 before hook」的 atom 上,必须在首个真实 await 之前
// 把副作用同步落盘(atomHistory / pendingSlots)。调用方依赖这一点做同 tick 读取:
//   - src/headless/lord-skill-gate:`void applyAtom(...)` 后立刻 buildView;
//   - rules/turnUsage 的 markOncePerTurn:fire-and-forget 投影 atom 后立刻读 view。
// 曾发生的回归:把 before-hook 折叠循环抽成 async helper 后,即使没有 hook 也会
// 无条件让出微任务,导致上述调用方读到旧状态。本文件把契约写成直接断言。
import { describe, it, expect } from 'vitest';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import { makeCard, makePlayer } from '../engine-harness';

function makeState() {
  const c1 = makeCard('c1', '杀', '♠');
  return createGameState({
    players: [
      makePlayer({ index: 0, name: 'P1', hand: [], character: '吕布' }),
      makePlayer({ index: 1, name: 'P2', hand: [], character: '曹操' }),
    ],
    cardMap: { c1 },
    zones: { deck: ['c1'], processing: [], discardPile: [] },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('applyAtom 零挂起时序契约', () => {
  it('无 hook 的普通 atom:同一同步段内写完 atomHistory 与手牌', () => {
    const state = makeState();
    const historyBefore = state.atomHistory.length;

    // 刻意不 await:断言的是「同步落盘」而不是「最终一致」
    void applyAtom(state, { type: '摸牌', player: 0, count: 1 });

    expect(state.atomHistory.length).toBe(historyBefore + 1);
    expect(state.players[0].hand).toEqual(['c1']);
    expect(state.zones.deck).toEqual([]);
  });

  it('等待型 atom:同一同步段内 pendingSlot 已可见(可立即 buildView)', () => {
    const state = makeState();
    const historyBefore = state.atomHistory.length;

    void applyAtom(state, { type: '出牌窗口', player: 0 });

    const slot = state.pendingSlots.get(0);
    expect(slot).toBeDefined();
    expect(slot!.atom.type).toBe('出牌窗口');
    // 等待型 atom 同步落盘:atom 条目在最前;紧随其后的可能是 pendingChanged 通知
    const entries = state.atomHistory.slice(historyBefore);
    expect(entries[0]).toMatchObject({ kind: 'atom', atom: { type: '出牌窗口' } });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    // 收尾:resolve 掉 slot(取消其计时器),避免真实定时器挂在测试进程里
    slot!.resolve();
  });
});
