// tests/scenarios/装备/藤甲.test.ts — 藤甲（fire 伤害免疫）v3 registerAtomHook 测试
//
// 锁定技：装备藤甲的角色受到火焰伤害时，防止此伤害（atom 被 cancel）。
// normal / thunder 伤害不受影响。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth, withArmor } from '../../engine-helpers';
import { registerAll as registerFixtureHooks } from '../../fixtures/藤甲';

describe('藤甲（火伤免疫）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerFixtureHooks();
  });

  it('装备藤甲受 fire 伤害时，cancel 整个链（无伤害、不写 server event）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', 'tengjia'), 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'fire' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events).toHaveLength(0);
  });

  it('藤甲对 normal 伤害不生效', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', 'tengjia'), 'P1', 4);
    const { state } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2' },
    ]);
    expect(state.players.P1.health).toBe(3);
  });

  it('藤甲对 thunder 伤害不生效', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', 'tengjia'), 'P1', 4);
    const { state } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBe(3);
  });
});
