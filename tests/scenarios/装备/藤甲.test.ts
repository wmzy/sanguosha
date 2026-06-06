// tests/scenarios/装备/藤甲.test.ts — 藤甲（防 normal 杀）v3 registerAtomHook 测试
//
// 锁定技：装备藤甲的角色受到【杀】造成的伤害（normal 类型）时，防止此伤害。
// fire / thunder 伤害不受藤甲影响（fire 杀照样 2 点穿藤甲）。
//
// 本文件聚焦 onBefore 三分支覆盖，sanity test + 完整覆盖见 藤甲-真规则.test.ts。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth, withArmor } from '../../engine-helpers';
import { registerAll as registerFixtureHooks } from '../../fixtures/藤甲';

describe('藤甲（防 normal 杀）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerFixtureHooks();
  });

  it('装备藤甲受 normal 伤害时，cancel 整个链（无伤害、不写 server event）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', 'tengjia'), 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'normal' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events).toHaveLength(0);
  });

  it('藤甲对 fire 伤害不生效（火杀照样造成伤害）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', 'tengjia'), 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'fire' },
    ]);
    expect(state.players.P1.health).toBe(3);
    expect(events.some((e) => e.type === 'damage')).toBe(true);
  });

  it('藤甲对 thunder 伤害不生效', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', 'tengjia'), 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBe(3);
    expect(events.some((e) => e.type === 'damage')).toBe(true);
  });
});
