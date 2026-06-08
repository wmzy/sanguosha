import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('reshuffle atom — rng 语义与 shuffleDeck 一致', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('reshuffle 后 rngState 由 rng.getState() 推进（不是合成 +length-1）', () => {
    const base = createTestGame({ deck: ['a'] });
    const s0 = { ...base, zones: { ...base.zones, discardPile: ['b', 'c', 'd', 'e'] } };
    const { state, logEntries: events } = applyAtoms(s0, [{ type: '重洗' }]);
    expect(events[0].atom.type).toBe('重洗');
    expect(state.zones.discardPile).toEqual([]);
    expect(state.zones.deck).toHaveLength(5);
    expect(state.rngState).not.toBe(s0.rngState + 3);
  });

  it('连续 reshuffle + shuffleDeck 推进 rng（state 持续变化）', () => {
    // int32 RNG 可能环绕；不能断言严格单调。意图：两次操作都真实消费
    // nextInt，state 都向前推进。验证第二次操作后的 state 与第一次不同。
    const base = createTestGame({ deck: ['a'] });
    const s0 = { ...base, zones: { ...base.zones, discardPile: ['b', 'c', 'd'] } };
    const r1 = applyAtoms(s0, [{ type: '重洗' }]);
    const s1 = r1.state;
    const r2 = applyAtoms(s1, [{ type: '洗牌' }]);
    const s2 = r2.state;
    expect(s1.rngState).not.toBe(s0.rngState);
    expect(s2.rngState).not.toBe(s1.rngState);
  });
});
