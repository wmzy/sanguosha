// tests/scenarios/装备/铁索连环.test.ts — 铁索连环（chained fire/thunder 伤害传导）v3 测试
//
// Task 1C-T5 范围：占位实现，验证 chained 状态受 fire/thunder 伤害时，
// 同链上其他 chained 角色会受同源同型同量伤害（additionalAtoms 递归）。
// 注意：v3 钩子骨架下 chained 角色之间会**无限反弹**（P1→P3→P1→…），
// 直到 applyAtoms 触发 MAX_HOOK_RECURSION 抛出（这是 plan 5.3 接受的占位实现）。
// 本测试 case 控制场景使 P1→P3 单次反弹后再被 MAX_HOOK_RECURSION 中断前的
// 状态可控：仅 P1、P3 chained，P2 未 chained，fire 伤害只从 P1 弹到 P3 一次。
// 正常伤害（normal）不传导，验证 v2 规则。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth } from '../../engine-helpers';
import { registerAll as registerFixtureHooks } from '../../fixtures/铁索连环';

describe('铁索连环（chained 传导）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerFixtureHooks();
  });

  it('P1、P3 都 chained，P1 受 fire 伤害 → P3 也受同伤害', () => {
    // 3 人局：P1, P2, P3
    const base = createTestGame({ playerCount: 3 });
    // 显式 setHealth（避免默认 maxHealth=4 假设）
    const s0 = {
      ...base,
      players: {
        ...base.players,
        P1: { ...base.players.P1, chained: true, health: 4, maxHealth: 4 },
        P2: { ...base.players.P2, chained: false, health: 4, maxHealth: 4 },
        P3: { ...base.players.P3, chained: true, health: 4, maxHealth: 4 },
      },
    };
    const { state, events } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2', damageType: 'fire' },
    ]);
    // P1 受伤害
    expect(state.players.P1.health).toBe(3);
    // P3 也受同伤害（chain 传导）
    expect(state.players.P3.health).toBe(3);
    // server log 含 2 个 damage 事件（P1 + P3）
    const damageEvents = events.filter(e => e.type === 'damage');
    expect(damageEvents).toHaveLength(2);
  });

  it('chained=false 的角色不参与传导', () => {
    const base = createTestGame({ playerCount: 3 });
    const s0 = {
      ...base,
      players: {
        ...base.players,
        P1: { ...base.players.P1, chained: true, health: 4, maxHealth: 4 },
        P2: { ...base.players.P2, chained: false, health: 4, maxHealth: 4 },
        P3: { ...base.players.P3, chained: true, health: 4, maxHealth: 4 },
      },
    };
    const { state } = applyAtoms(s0, [
      { type: 'damage', target: 'P1', amount: 1, source: 'P2' }, // normal
    ]);
    // normal 伤害不传导（v2 规则：仅 fire/thunder 传导）
    expect(state.players.P3.health).toBe(4);
  });
});
