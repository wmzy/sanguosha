// LEGACY TEST: references deleted v2 modules - skipped
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
// import { clearAtomHooks } from '@engine/skill-hook';  // LEGACY: removed (v2 module deleted)
// import { registerAllAtoms } from '@engine/atoms';  // LEGACY: removed (registerAllAtoms no longer exported)
import { createTestGame } from '../engine-helpers';

describe.skip('shuffleDeck atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('shuffleDeck 推进 RNG 但 deck 内容不变', () => {
    const s0 = createTestGame({ deck: ['a', 'b', 'c', 'd'] });
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '洗牌' },
    ]);
    expect(state.zones.deck.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(state.rngState).not.toBe(s0.rngState);
    expect(events[0].atom.type).toBe('洗牌');
  });
});
