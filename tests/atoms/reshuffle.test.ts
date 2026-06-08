import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { createTestGame } from '../engine-helpers';
import { registerAllAtoms } from '@engine/atoms';

describe('reshuffle atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    registerAllAtoms();
  });

  it('reshuffle 后 serverLog 末尾出现 reshuffle 事件，弃牌堆洗回牌堆', () => {
    const state = createTestGame();
    const emptied = { ...state, zones: { deck: [], discardPile: ['c1', 'c2', 'c3'] } };
    const { state: next, logEntries: events } = applyAtoms(emptied, [
      { type: '重洗' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].atom.type).toBe('重洗');
    expect(next.zones.discardPile).toEqual([]);
    expect(next.zones.deck).toHaveLength(3);
    expect([...next.zones.deck].sort()).toEqual(['c1', 'c2', 'c3']);
    expect(next.rngState).not.toBe(state.rngState); // 推进 RNG
  });

  it('reshuffle 弃牌堆为空时无操作', () => {
    const state = createTestGame();
    const { state: next, logEntries: events } = applyAtoms(state, [
      { type: '重洗' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].atom.type).toBe('重洗');
    expect(next.zones.deck).toEqual(state.zones.deck);
    expect(next.zones.discardPile).toEqual(state.zones.discardPile);
    expect(next.rngState).toBe(state.rngState);
  });

  it('reshuffle 不可被 onAfter 钩子副作用反向触发死循环', () => {
    // 防回归：连续多次 reshuffle 不应死循环
    expect(() => {
      applyAtoms(createTestGame(), [
        { type: '重洗' },
        { type: '重洗' },
        { type: '重洗' },
      ]);
    }).not.toThrow();
  });

  it('§4.7 fix: draw 牌堆为空触发 reshuffle 时，serverLog 含 reshuffle 事件', () => {
    // 端到端：draw 的二次重洗不再静默；replay/审计可看到 reshuffle 事件
    const state = createTestGame();
    const emptied = { ...state, zones: { deck: [], discardPile: ['c1', 'c2'] } };
    const { state: next } = applyAtoms(emptied, [
      { type: '摸牌', player: 'P1', count: 1 },
    ]);
    const types = next.serverLog.map(e => e.atom.type);
    expect(types).toContain('重洗');
    expect(types).toContain('摸牌');
    // 顺序：reshuffle 必须先于 draw 出现（先洗回牌堆再抽牌）
    expect(types.indexOf('重洗')).toBeLessThan(types.indexOf('摸牌'));
  });
});
