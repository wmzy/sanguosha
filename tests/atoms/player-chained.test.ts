import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';

describe('PlayerState.chained', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('createTestGame 默认 chained=false', () => {
    const s0 = createTestGame();
    expect(s0.players.P1.chained).toBe(false);
  });

  it('setVar 写到 vars.chained 不影响 .chained 字段', () => {
    const s0 = createTestGame();
    const { state } = applyAtoms(s0, [
      { type: '设置变量', player: 'P1', key: 'chained', value: true },
    ]);
    expect(state.players.P1.chained).toBe(false);
    expect(state.players.P1.vars.chained).toBe(true);
  });
});
