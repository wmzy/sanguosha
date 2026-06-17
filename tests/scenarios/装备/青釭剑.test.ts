// LEGACY TEST: references deleted v2 modules - skipped
import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
// import { clearAtomHooks } from '@engine/skill-hook';  // LEGACY: removed (v2 module deleted)
// import { registerAllAtoms } from '@engine/atoms';  // LEGACY: removed (registerAllAtoms no longer exported)
import { createTestGame, withWeapon, setHealth } from '../../engine-helpers';
import { registerAll as registerFixtureHooks } from '../../fixtures/青釭剑';

describe.skip('青釭剑 v3（无视防具）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerFixtureHooks();
  });

  it('source 有青釭剑时，钩子注入 penetrateArmor 上下文变量', () => {
    // §4.3 修：v3 hook 在 damage onAfter 注入 setCtxVar(penetrateArmor=true)
    // 完整防具穿透逻辑（藤甲/仁王盾钩子读 ctx var 取消）留 P2
    // 本测试验证：钩子触发后 setCtxVar 出现在 serverLog；damage 仍正常 apply
    const s0 = withWeapon(setHealth(createTestGame(), 'P1', 4), 'P2', '青釭剑');
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    // damage 应该被应用（青釭剑本身不阻止 damage，只标记穿透）
    // 完整防具逻辑留 P2
    expect(state.players.P1.health).toBe(3);
    // server event 包含 damage
    expect(events.some((e) => e.atom.type === '造成伤害')).toBe(true);
    // 钩子通过 additionalAtoms 注入了 setCtxVar(penetrateArmor=true)
    expect(events.some((e) => e.atom.type === '设置上下文变量')).toBe(true);
  });

  it('source 未装备青釭剑，钩子不触发', () => {
    const s0 = setHealth(createTestGame(), 'P1', 4);
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '造成伤害', target: 'P1', amount: 1, source: 'P2', cardId: 'kill1' },
    ]);
    expect(state.players.P1.health).toBe(3);
    // 没有青釭剑 → 钩子不触发 → 没有 setCtxVar 事件
    expect(events.some((e) => e.atom.type === '设置上下文变量')).toBe(false);
  });
});
