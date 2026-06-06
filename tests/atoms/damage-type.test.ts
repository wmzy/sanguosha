import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth } from '../engine-helpers';

describe('damage.type', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('默认 type 为 normal，写入 server event payload', () => {
    const s0 = setHealth(createTestGame(), 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2' },
    ]);
    expect(state.players.P1.health).toBe(3);
    expect(events[0].type).toBe('damage');
    expect(events[0].payload).toMatchObject({ type: 'normal', amount: 1 });
  });

  it.each(['fire', 'thunder'] as const)('damageType=%s 写入 payload.type', (t) => {
    const s0 = setHealth(createTestGame(), 'P1', 3);
    const { events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: t },
    ]);
    expect(events[0].payload).toMatchObject({ type: t });
  });

  it('toEvents payload 保留 damageType=fire 字段', () => {
    const s0 = setHealth(createTestGame(), 'P1', 4);
    const { events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 2, source: 'P2', damageType: 'fire' },
    ]);
    expect(events[0].payload).toHaveProperty('type', 'fire');
  });
});
