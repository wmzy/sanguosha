// LEGACY TEST: references deleted v2 modules - skipped
// tests/scenarios/装备/大雾.test.ts — 大雾（防 non-thunder）v3 registerAtomHook 测试
//
// 神诸葛亮"大雾"标记：防止受到的所有非雷电伤害（normal + fire cancel，thunder 穿透）。
// v3 路径：damage onBefore 钩子。
//
// 本文件聚焦 onBefore 三分支覆盖，sanity test + 完整覆盖见 大雾-真规则.test.ts。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
// import { clearAtomHooks } from '@engine/skill-hook';  // LEGACY: removed (v2 module deleted)
// import { registerAllAtoms } from '@engine/atoms';  // LEGACY: removed (registerAllAtoms no longer exported)
import { createTestGame, setHealth, withArmor } from '../../engine-helpers';
import { registerAll as registerFixtureHooks } from '../../fixtures/大雾';

describe.skip('大雾（防 non-thunder 真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerFixtureHooks();
  });

  it('装备大雾受 normal 伤害时，cancel 整个链（无伤害、不写 server event）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '大雾'), 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', damageType: 'normal' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events).toHaveLength(0);
  });

  it('装备大雾受 fire 伤害时，cancel 整个链（无伤害、不写 server event）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '大雾'), 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', damageType: 'fire' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events).toHaveLength(0);
  });

  it('大雾对 thunder 伤害不生效（thunder 穿透大雾）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '大雾'), 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBe(3);
    expect(events.some((e) => e.atom.type === '造成伤害')).toBe(true);
  });
});
