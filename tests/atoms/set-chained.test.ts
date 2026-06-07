import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('setChained atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('setChained=true 把目标设为连环', () => {
    const s0 = createTestGame();
    const { state } = applyAtoms(s0, [
      { type: '设横置', target: 'P1', chained: true },
    ]);
    expect(state.players.P1.chained).toBe(true);
  });

  it('setChained=false 解除连环', () => {
    const base = createTestGame();
    const s0 = { ...base, players: { ...base.players, P1: { ...base.players.P1, chained: true } } };
    const { state } = applyAtoms(s0, [
      { type: '设横置', target: 'P1', chained: false },
    ]);
    expect(state.players.P1.chained).toBe(false);
  });

  it('setChained 写入 server event payload', () => {
    const s0 = createTestGame();
    const { events } = applyAtoms(s0, [
      { type: '设横置', target: 'P1', chained: true },
    ]);
    expect(events[0].type).toBe('设横置');
    expect(events[0].payload).toMatchObject({ target: 'P1', chained: true });
  });
});
