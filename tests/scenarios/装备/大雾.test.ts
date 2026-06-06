// tests/scenarios/装备/大雾.test.ts — 大雾（thunder 以外伤害无效，Task 2 仅测 thunder 免疫）v3 测试
//
// 神诸葛亮"大雾"标记：防止受到的所有非雷电伤害。
// 本 Task 范围：实现 v3 registerAtomHook，对 thunder 伤害 cancel。
// 非雷电（normal / fire）伤害的完整实现涉及 chained 状态（[T-12] P1-B）。
//
// 注：神诸葛亮"大雾"是 Mark-style 技能（给一名角色"大雾"标记），
// 不是装备。此 Task 走 fixture 模拟"目标拥有大雾标记 = 装备视为大雾防具"，
// 抽象与藤甲对称。
//
// TODO(P1-B): complete rule — 真实规则是"非雷电伤害防止"（normal + fire 均免疫），
// 下文 cases 2/3 显式记录"non-thunder 路径在 v3 钩子骨架下不生效"。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth, withArmor } from '../../engine-helpers';
import { registerAll as registerFixtureHooks } from '../../fixtures/大雾';

describe('大雾（thunder 免疫，本 Task 范围）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerFixtureHooks();
  });

  it('装备大雾受 thunder 伤害时，cancel 整个链（无伤害、不写 server event）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', 'daqi'), 'P1', 4);
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events).toHaveLength(0);
  });

  // TODO(P1-B): complete rule — 完整大雾"非雷电全部防止"应使本用例 health 维持 4；
  // 当前 v3 钩子骨架仅 cancel thunder，non-thunder 路径未拦截（见 daqi.ts 头部注释）。
  it('大雾对 normal 伤害不生效（本 Task 范围：thunder-only 实现）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', 'daqi'), 'P1', 4);
    const { state } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2' },
    ]);
    expect(state.players.P1.health).toBe(3);
  });

  // TODO(P1-B): complete rule — 同上，完整大雾应使本用例 health 维持 4。
  it('大雾对 fire 伤害不生效（本 Task 范围：thunder-only 实现）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', 'daqi'), 'P1', 4);
    const { state } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'fire' },
    ]);
    expect(state.players.P1.health).toBe(3);
  });
});
