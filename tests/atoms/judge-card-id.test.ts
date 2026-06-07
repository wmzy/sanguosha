/**
 * tests/atoms/judge-card-id.test.ts — §4.6 修：判定牌不读弃牌堆
 *
 * Bug: judge atom 的 getResult() 从 discardPile[top] 读判定牌，但全局
 * discardPile 在判定过程中可能被其他弃牌（杀/无懈/出牌）插错牌。
 *
 * 修法：judge.apply() 显式把判定牌 cardId/suit/color 写入 state.localVars，
 * getResult() 读 state.localVars 而不是 discardPile。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('judge atom §4.6 修：判定牌不读弃牌堆', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('judge 后 state.localVars.judgeCardId 是正确那张（顶牌）', () => {
    // 现有约定：top = deck[length-1]
    // deck: ['c1', 'c2', 'c3'] → 顶牌 c3
    // 用 state 覆盖塞入 discardPile 中的"幽灵牌"，验证判定不读弃牌堆
    const base = createTestGame({
      deck: ['c1', 'c2', 'c3'],
    });
    const s0: typeof base = {
      ...base,
      zones: { ...base.zones, discardPile: ['ghost1', 'ghost2'] },
    };
    const { state, events } = applyAtoms(s0, [
      { type: '判定', player: 'P1' },
    ]);
    // 验证：判定牌来自 deck 顶（c3），不读 discardPile
    expect(state.localVars?.judgeCardId).toBe('c3');
    // toEvents payload 同步带 cardId
    const judgeEvent = events.find(e => e.type === '判定');
    expect(judgeEvent).toBeDefined();
    expect((judgeEvent!.payload as { cardId: string }).cardId).toBe('c3');
  });

  it('期间有其他 discard 操作，判定牌不被覆盖', () => {
    // §4.6 修的核心：getResult 读 ctx.localVars 而非 discardPile[top]
    // 测试：judge + discard + 验证 judge cardId 仍是原牌
    // deck: ['c1', 'c2'] → 顶牌 c2
    const s0 = createTestGame({
      deck: ['c1', 'c2'],
      hand: { P1: ['c3'] },
    });
    const { state } = applyAtoms(s0, [
      { type: '判定', player: 'P1' },
      { type: '弃置', player: 'P1', cardIds: ['c3'] },
    ]);
    // 判定牌仍是 c2（不是被 discard 推上去的 c3）
    expect(state.localVars?.judgeCardId).toBe('c2');
  });
});
