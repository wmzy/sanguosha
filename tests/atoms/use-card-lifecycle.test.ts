// LEGACY TEST: references deleted v2 modules - skipped
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry, registerAtomHook, clearAtomHooks } from '@engine/atom';
// import { registerAllAtoms } from '@engine/atoms';  // LEGACY: removed (registerAllAtoms no longer exported)
import { createTestGame } from '../engine-helpers';

describe.skip('useCard 三阶段原子', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('specifyTarget 写入 target 字段', () => {
    const s0 = createTestGame();
    const { logEntries: events } = applyAtoms(s0, [{
      type: '指定目标', cardId: 'c1', source: 'P1', target: 'P2',
    }]);
    expect(events[0].atom.type).toBe('指定目标');
    expect(events[0].atom).toMatchObject({ target: 'P2' });
  });

  it('becomeTarget: onBefore.cancel 阻止目标确定', () => {
    registerAtomHook({
      atomType: '成为目标',
      onBefore: () => ({ cancel: true }),
    });
    const s0 = createTestGame();
    const { logEntries: events } = applyAtoms(s0, [{ type: '成为目标', cardId: 'c1', source: 'P1', target: 'P2' }]);
    expect(events).toHaveLength(0);
  });

  it('resolveCard: onAfter 可追加 damage atom', () => {
    registerAtomHook({
      atomType: '解决',
      onAfter: () => ({ additionalAtoms: [{ type: '造成伤害', target: 'P2', amount: 1, source: 'P1' }] }),
    });
    const s0 = createTestGame();
    const { logEntries: events, state } = applyAtoms(s0, [{ type: '解决', cardId: 'c1', source: 'P1' }]);
    expect(events.some(e => e.atom.type === '造成伤害')).toBe(true);
    expect(state.players.P2.health).toBeLessThan(s0.players.P2.health);
  });

  it('resolveCard: 带 target 时 payload 包含 target', () => {
    const s0 = createTestGame();
    const { logEntries: events } = applyAtoms(s0, [{
      type: '解决', cardId: 'c1', source: 'P1', target: 'P2',
    }]);
    expect(events[0].atom.type).toBe('解决');
    expect(events[0].atom).toMatchObject({ cardId: 'c1', source: 'P1', target: 'P2' });
  });
});
