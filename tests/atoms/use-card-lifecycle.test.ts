import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry, registerAtomHook, clearAtomHooks } from '@engine/atom';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('useCard 三阶段原子', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('specifyTarget 写入 target 字段', () => {
    const s0 = createTestGame();
    const { state, events } = applyAtoms(s0, [{
      type: 'specifyTarget', cardId: 'c1', source: 'P1', target: 'P2',
    }]);
    expect(events[0].type).toBe('specifyTarget');
    expect(events[0].payload).toMatchObject({ target: 'P2' });
  });

  it('becomeTarget: onBefore.cancel 阻止目标确定', () => {
    registerAtomHook({
      atomType: 'becomeTarget',
      onBefore: () => ({ cancel: true }),
    });
    const s0 = createTestGame();
    const { events } = applyAtoms(s0, [{ type: 'becomeTarget', cardId: 'c1', source: 'P1', target: 'P2' }]);
    expect(events).toHaveLength(0);
  });

  it('resolveCard: onAfter 可追加 damage atom', () => {
    registerAtomHook({
      atomType: 'resolveCard',
      onAfter: () => ({ additionalAtoms: [{ type: 'damage', target: 'P2', amount: 1, source: 'P1' }] }),
    });
    const s0 = createTestGame();
    const { events, state } = applyAtoms(s0, [{ type: 'resolveCard', cardId: 'c1', source: 'P1' }]);
    expect(events.some(e => e.type === 'damage')).toBe(true);
    expect(state.players.P2.health).toBeLessThan(s0.players.P2.health);
  });
});
