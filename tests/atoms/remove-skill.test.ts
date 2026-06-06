import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';
import type { TriggerRule } from '@engine/types';

function makeTrigger(player: string, skillId: string): TriggerRule {
  return { player, skillId, source: 'character', event: 'phaseBegin', priority: 5 };
}

describe('removeSkill atom', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('removeSkill 从 state.triggers 移除该玩家该 skill 的全部 TriggerRule', () => {
    const s0 = { ...createTestGame(), triggers: [makeTrigger('P1', '断肠')] };
    const { state, events } = applyAtoms(s0, [
      { type: 'removeSkill', player: 'P1', skillId: '断肠' },
    ]);
    expect(state.triggers).toEqual([]);
    expect(events[0].type).toBe('removeSkill');
  });

  it('removeSkill 不影响其他玩家的同名技能', () => {
    const s0 = {
      ...createTestGame(),
      triggers: [makeTrigger('P1', '断肠'), makeTrigger('P2', '断肠')],
    };
    const { state } = applyAtoms(s0, [
      { type: 'removeSkill', player: 'P1', skillId: '断肠' },
    ]);
    expect(state.triggers).toHaveLength(1);
    expect(state.triggers[0].player).toBe('P2');
  });

  it('removeSkill 不存在的 skillId 是 noop', () => {
    const s0 = { ...createTestGame(), triggers: [makeTrigger('P1', '激将')] };
    const { state } = applyAtoms(s0, [
      { type: 'removeSkill', player: 'P1', skillId: '鬼道' },
    ]);
    expect(state.triggers).toHaveLength(1);
  });
});
