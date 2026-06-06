import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth } from '../engine-helpers';

describe('loseHealth atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('loseHealth 等于 health -= n，无 source', () => {
    let s0 = createTestGame();
    s0 = setHealth(s0, 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'loseHealth', target: 'P1', amount: 2 },
    ]);
    expect(state.players.P1.health).toBe(2);
    expect(events[0].type).toBe('loseHealth');
    expect(events[0].payload).toMatchObject({ target: 'P1', amount: 2 });
    expect(events[0].payload).not.toHaveProperty('source');
  });

  it('loseHealth 不会触发 damage onAfter 钩子', () => {
    let s0 = createTestGame();
    s0 = setHealth(s0, 'P1', 4);
    const { state } = applyAtoms(s0, [
      { type: 'loseHealth', target: 'P1', amount: 1 },
    ]);
    expect(state.players.P1.health).toBe(3);
  });

  it('loseHealth 不进濒死（amount=0 时不扣血）', () => {
    let s0 = createTestGame();
    s0 = setHealth(s0, 'P1', 4);
    const { state } = applyAtoms(s0, [
      { type: 'loseHealth', target: 'P1', amount: 0 },
    ]);
    expect(state.players.P1.health).toBe(4);
  });
});
