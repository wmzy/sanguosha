// LEGACY TEST: references deleted v2 modules - skipped
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
// import { clearAtomHooks } from '@engine/skill-hook';  // LEGACY: removed (v2 module deleted)
// import { registerAllAtoms } from '@engine/atoms';  // LEGACY: removed (registerAllAtoms no longer exported)
import { createTestGame, setHealth } from '../engine-helpers';

describe.skip('loseHealth atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('loseHealth 等于 health -= n，无 source', () => {
    let s0 = createTestGame();
    s0 = setHealth(s0, 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '失去体力', target: 'P1', amount: 2 },
    ]);
    expect(state.players.P1.health).toBe(2);
    expect(events[0].atom.type).toBe('失去体力');
    expect(events[0].atom).toMatchObject({ target: 'P1', amount: 2 });
    expect(events[0].atom).not.toHaveProperty('source');
  });

  it('loseHealth 不会触发 damage onAfter 钩子', () => {
    let s0 = createTestGame();
    s0 = setHealth(s0, 'P1', 4);
    const { state } = applyAtoms(s0, [
      { type: '失去体力', target: 'P1', amount: 1 },
    ]);
    expect(state.players.P1.health).toBe(3);
  });

  it('loseHealth 不进濒死（amount=0 时不扣血）', () => {
    let s0 = createTestGame();
    s0 = setHealth(s0, 'P1', 4);
    const { state } = applyAtoms(s0, [
      { type: '失去体力', target: 'P1', amount: 0 },
    ]);
    expect(state.players.P1.health).toBe(4);
  });
});
