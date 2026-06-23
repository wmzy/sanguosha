// 回归测试:一次 dispatch 内多个 applyAtom 各自有唯一 seq。
//
// Bug 根因(事件流重构引入):
//   state.seq 只在 dispatch 入口递增一次。一次 dispatch 内的多个 applyAtom
//   (主公 respond → 分配武将 → 并行选将)push atomHistory 时共用同一 seq。
//   broadcastNewState 用 lastBroadcastSeq 水位过滤,导致同 seq 后续事件被跳过
//   —— 非主公玩家收不到并行选将事件,无法选将。
//
// 修复:每个 atomHistory.push 前递增 state.seq,保证事件 seq 唯一。
import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import { eventsForViewer } from '../../src/engine/view/events-for-viewer';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { GameState } from '../../src/engine/types';

describe('atomHistory seq 唯一性:同一 dispatch 内多 atom 不丢事件', () => {
  beforeEach(() => resetForTest());

  it('连续 applyAtom 的 atomHistory entry 各有唯一 seq', async () => {
    const { applyAtom } = await import('../../src/engine/create-engine');
    const state = createGameState({
      players: [{
        index: 0, name: 'p0', character: '', health: 4, maxHealth: 4,
        alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [],
      }],
      cardMap: {
        c1: { id: 'c1', name: '杀', suit: '♠', rank: '7', type: '基本牌' },
        c2: { id: 'c2', name: '杀', suit: '♠', rank: '8', type: '基本牌' },
      },
      zones: { deck: ['c1', 'c2'], discardPile: [], processing: [] },
      seq: 0,
    });

    // 连续两次 applyAtom(模拟一次 dispatch 内的多 atom 场景)
    await applyAtom(state, { type: '摸牌', player: 0, count: 1 } as any);
    await applyAtom(state, { type: '摸牌', player: 0, count: 1 } as any);

    const atomEntries = state.atomHistory.filter(e => e.kind === 'atom');
    expect(atomEntries.length).toBe(2);
    // 核心:两个 atom 的 seq 必须不同
    expect(atomEntries[0].seq).not.toBe(atomEntries[1].seq);
    expect(atomEntries[1].seq).toBeGreaterThan(atomEntries[0].seq);
  });

  it('水位过滤不丢同批次事件:sinceSeq=第一个 atom seq,第二个 atom 仍可见', async () => {
    const { applyAtom } = await import('../../src/engine/create-engine');
    const state = createGameState({
      players: [{
        index: 0, name: 'p0', character: '', health: 4, maxHealth: 4,
        alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [],
      }],
      cardMap: {
        c1: { id: 'c1', name: '杀', suit: '♠', rank: '7', type: '基本牌' },
        c2: { id: 'c2', name: '杀', suit: '♠', rank: '8', type: '基本牌' },
      },
      zones: { deck: ['c1', 'c2'], discardPile: [], processing: [] },
      seq: 0,
    });

    await applyAtom(state, { type: '摸牌', player: 0, count: 1 } as any);
    const firstSeq = state.atomHistory.find(e => e.kind === 'atom')!.seq;

    await applyAtom(state, { type: '摸牌', player: 0, count: 1 } as any);

    // 模拟 broadcastNewState:水位推进到 firstSeq 后,查 sinceSeq=firstSeq 的事件
    // 修复前:第二个 atom seq === firstSeq → 被跳过(events.length=0)→ 非 owner 看不到
    // 修复后:第二个 atom seq > firstSeq → 可见
    const events = eventsForViewer(state, 0, firstSeq);
    expect(events.length).toBe(1);
    expect(events[0].seq).toBeGreaterThan(firstSeq);
  });
});
