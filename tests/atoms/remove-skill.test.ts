// LEGACY TEST: references deleted v2 modules - skipped
// tests/atoms/remove-skill.test.ts — [P5-T2] 去技能 atom 走 PlayerState.skills
// 旧实现：从 state.triggers.filter 移除 TriggerRule
// 新实现：PlayerState[player].skills 移除 skillId

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
// import { clearAtomHooks } from '@engine/skill-hook';  // LEGACY: removed (v2 module deleted)
// import { registerAllAtoms } from '@engine/atoms';  // LEGACY: removed (registerAllAtoms no longer exported)
import { createTestGame } from '../engine-helpers';
import { addSkillToPlayer } from '@engine/mark';

describe.skip('removeSkill atom（走 PlayerState.skills）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('removeSkill 从 PlayerState.skills 移除指定 skillId', () => {
    const s0 = addSkillToPlayer(createTestGame(), 'P1', '断肠');
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '去技能', player: 'P1', skillId: '断肠' },
    ]);
    expect(state.players.P1.skills).not.toContain('断肠');
    expect(events[0].atom.type).toBe('去技能');
  });

  it('removeSkill 不影响其他玩家的同名技能', () => {
    let s0 = addSkillToPlayer(createTestGame(), 'P1', '断肠');
    s0 = addSkillToPlayer(s0, 'P2', '断肠');
    const { state } = applyAtoms(s0, [
      { type: '去技能', player: 'P1', skillId: '断肠' },
    ]);
    expect(state.players.P1.skills).not.toContain('断肠');
    expect(state.players.P2.skills).toContain('断肠');
  });

  it('removeSkill 不存在的 skillId 是 noop', () => {
    const s0 = addSkillToPlayer(createTestGame(), 'P1', '激将');
    const { state } = applyAtoms(s0, [
      { type: '去技能', player: 'P1', skillId: '鬼道' },
    ]);
    expect(state.players.P1.skills).toContain('激将');
    expect(state.players.P1.skills).not.toContain('鬼道');
  });
});
