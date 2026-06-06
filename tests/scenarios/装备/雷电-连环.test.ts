// tests/scenarios/装备/雷电-连环.test.ts — 雷电伤害 + 铁索连环传导（真 game rule）
//
// Task P2-T3 范围：
// 1. 雷电伤害走 chained-propagation（1C-T5 已含 fire/thunder 列表）→ 链上其他角色
//    也受同源同型同量 thunder 伤害（onAfter.additionalAtoms 递归，skipHooks 防无限反弹）。
// 2. 大雾占位（1A-T2）只防 thunder——这是 1A-T2 已知的反转 bug：
//    真 game rule 大雾应防"非雷电伤害"，但当前实现防 thunder。
//    本 Task 不修 1A-T2 大雾反转，留 follow-up；本测试场景**不**装备大雾，
//    只验证 chained-propagation 对 thunder 的传导。
//
// 1C-T5 占位实现已知限制：P1→P3 单次反弹后被 MAX_HOOK_RECURSION 截断。
// 本测试 case 控制场景使 P1→P3 单次反弹后 P3 因 skipHooks 不再追加 P1。
// 注：P1.chained=true → P3.chained=true 反弹到 P3 时 targetPlayer.chained
// 也是 true，但 onAfter 用 skipHooks=true 递归，P3 不会再触发自己。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../../engine-helpers';
import { registerAll as registerChained } from '../../fixtures/铁索连环';

describe('雷电伤害 + 铁索连环传导（真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerChained();
  });

  it('thunder dmg + P1/P3 都 chained → P1 受伤 P3 也受同 thunder 伤害', () => {
    // 3 人局：P1 受雷击 thunder 伤害 → chained-propagation onAfter
    // 给 P3 追加同源同型同量 thunder damage（P2 不在链上）
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
    const { state, events } = applyAtoms(s0, [
      {
        type: 'damage',
        target: 'P1',
        amount: 3,
        source: '张角',
        cardId: 'leiji1',
        damageType: 'thunder',
      },
    ]);
    // P1 受 3 点伤害：4 → 1
    expect(state.players.P1.health).toBe(1);
    // P3 也受同 thunder 伤害（chain 传导）：4 → 1
    expect(state.players.P3.health).toBe(1);
    // P2 不在链上，未受伤
    expect(state.players.P2.health).toBe(4);
    // server log 含 2 个 damage 事件（P1 + P3）
    const damageEvents = events.filter((e) => e.type === 'damage');
    expect(damageEvents).toHaveLength(2);
  });
});
