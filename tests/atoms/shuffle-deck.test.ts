import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('shuffleDeck atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('shuffleDeck 推进 RNG 但 deck 内容不变', () => {
    const s0 = createTestGame({ deck: ['a', 'b', 'c', 'd'] });
    const { state, events } = applyAtoms(s0, [
      { type: '洗牌' },
    ]);
    expect(state.zones.deck.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(state.rngState).not.toBe(s0.rngState);
    expect(events[0].type).toBe('洗牌');
  });
});
