// tests/atoms/set-chained.test.ts — setChained atom 改写走 Mark（P5-T1）
// 旧：直接写 PlayerState.chained
// 新：chained=true → addMark('chained')；chained=false → removeMark('chained')

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';
import { hasChained, addMarkToPlayer, CHAINED_MARK } from '@engine/mark';

describe('setChained atom（走 Mark）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('setChained=true 加 chained Mark', () => {
    const s0 = createTestGame();
    const { state } = applyAtoms(s0, [
      { type: '设横置', target: 'P1', chained: true },
    ]);
    expect(hasChained(state, 'P1')).toBe(true);
  });

  it('setChained=false 解除 chained Mark', () => {
    const base = createTestGame();
    const s0 = addMarkToPlayer(base, 'P1', CHAINED_MARK);
    const { state } = applyAtoms(s0, [
      { type: '设横置', target: 'P1', chained: false },
    ]);
    expect(hasChained(state, 'P1')).toBe(false);
  });

  it('setChained 写入 server event payload（target + chained 保留）', () => {
    const s0 = createTestGame();
    const { events } = applyAtoms(s0, [
      { type: '设横置', target: 'P1', chained: true },
    ]);
    expect(events[0].type).toBe('设横置');
    expect(events[0].payload).toMatchObject({ target: 'P1', chained: true });
  });

  it('setChained 幂等：连续两次 true 不会重复加 Mark', () => {
    const s0 = createTestGame();
    const { state } = applyAtoms(s0, [
      { type: '设横置', target: 'P1', chained: true },
      { type: '设横置', target: 'P1', chained: true },
    ]);
    const marks = state.marks['P1'] ?? [];
    expect(marks.filter((m) => m.id === 'chained')).toHaveLength(1);
  });
});
