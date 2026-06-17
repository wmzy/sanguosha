// LEGACY TEST: references deleted v2 modules - skipped
// tests/atoms/player-chained.test.ts — chained 已迁 Mark 体系（P5-T1）
// PlayerState.chained 字段不再存在；chained 状态走 state.marks[P1] 含 id='chained'。
// 本测试覆盖：
//   1. createTestGame 默认无 chained Mark
//   2. setVar 写到 vars.chained 仍是 vars 私有，不影响 Mark

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
// import { clearAtomHooks } from '@engine/skill-hook';  // LEGACY: removed (v2 module deleted)
// import { registerAllAtoms } from '@engine/atoms';  // LEGACY: removed (registerAllAtoms no longer exported)
import { createTestGame } from '../engine-helpers';
import { hasChained } from '@engine/mark';

describe.skip('chained Mark', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('createTestGame 默认无 chained Mark', () => {
    const s0 = createTestGame();
    expect(hasChained(s0, 'P1')).toBe(false);
  });

  it('setVar 写到 vars.chained 不影响 chained Mark', () => {
    const s0 = createTestGame();
    const { state } = applyAtoms(s0, [
      { type: '设置变量', player: 'P1', key: 'chained', value: true },
    ]);
    expect(hasChained(state, 'P1')).toBe(false);
    expect(state.players.P1.vars.chained).toBe(true);
  });
});
