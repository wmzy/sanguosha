// tests/scenarios/装备/大雾-真规则.test.ts — 大雾（防 non-thunder，thunder 穿透）真 game rule
//
// 神诸葛亮"大雾"标记：防止受到的所有非雷电伤害（normal + fire cancel，thunder 穿透）。
// v3 路径：damage onBefore 钩子。
//
// 此文件覆盖 P1-1A-T2 反转 bug 后的真 game rule 全部 3 个伤害类型分支：
// - normal → cancel
// - fire   → cancel
// - thunder→ 不 cancel（穿透大雾）
// - 未指定 damageType（默认 normal）→ cancel

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame, setHealth, withArmor } from '../../engine-helpers';
import { addMarkToPlayer, CHAINED_MARK } from '@engine/mark';
import { registerAll as registerDaqi } from '../../fixtures/大雾';
import { registerAll as registerChained } from '../../fixtures/铁索连环';

describe('大雾真 game rule（防 non-thunder）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerDaqi();
    registerChained();
  });

  it('装备大雾 + normal 伤害 → cancel', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '大雾'), 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', damageType: 'normal' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(0);
  });

  it('装备大雾 + fire 伤害 → cancel', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '大雾'), 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      {
        type: '造成伤害',
        target: 'P1',
        amount: 1,
        source: 'P2',
        damageType: 'fire',
        cardId: 'fireKill',
      },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(0);
  });

  it('装备大雾 + thunder 伤害 → 不 cancel（穿透大雾）', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '大雾'), 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 3, source: '张角', damageType: 'thunder' },
    ]);
    expect(state.players.P1.health).toBe(1);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(1);
  });

  it('装备大雾 + 未指定 damageType（默认 normal）→ cancel', () => {
    const s0 = setHealth(withArmor(createTestGame(), 'P1', '大雾'), 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2' },
    ]);
    expect(state.players.P1.health).toBe(4);
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(0);
  });
  it('装备大雾 + thunder + chained → 链上其他角色也受 thunder 伤害（穿透大雾 + 链传导）', () => {
    const base = createTestGame({ playerCount: 3 });
    // P1 / P3 设横置（走 Mark 体系，P5-T1）：用 addMarkToPlayer + 设血量
    let s0 = addMarkToPlayer(base, 'P1', CHAINED_MARK);
    s0 = addMarkToPlayer(s0, 'P3', CHAINED_MARK);
    s0 = setHealth(s0, 'P1', 4);
    s0 = setHealth(s0, 'P2', 4);
    s0 = setHealth(s0, 'P3', 4);
    s0.players.P1.equipment = { ...s0.players.P1.equipment, 防具: '大雾' };
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 3, source: '张角', damageType: 'thunder' },
    ]);
    // P1 装备大雾但 thunder 穿透 → 4 → 1
    expect(state.players.P1.health).toBe(1);
    // P3 链传导（thunder 穿透大雾，P3 无大雾） → 4 → 1
    expect(state.players.P3.health).toBe(1);
    // 2 个 damage 事件（P1 + P3），P2 不在链
    expect(events.filter((e) => e.atom.type === '造成伤害')).toHaveLength(2);
  });
});
