// tests/integration/engine-isolation.test.ts
import { describe, it, expect } from 'vitest';
import { createTestEngine } from '../engine-helpers';
import { registerAtomHook, getDefaultHookRegistry } from '@engine/skill-hook';

describe('createEngine 多实例隔离', () => {
  it('每个 instance 的 hookRegistry 独立', () => {
    const engine1 = createTestEngine();
    const engine2 = createTestEngine();

    // 在 engine2 的 hookRegistry 中注册一个钩子
    engine2.hooks.register({
      atomType: 'damage',
      onAfter: () => {},
    });

    // engine1 的 hookRegistry 不应有这个钩子（engine2 独有的）
    const engine1Damage = engine1.hooks.getByAtomType('damage').length;
    const engine2Damage = engine2.hooks.getByAtomType('damage').length;
    expect(engine2Damage).toBeGreaterThan(engine1Damage);
  });

  it('clearForTest 重置全局 hooks 并保留 instance 技能', () => {
    const engine = createTestEngine();

    // 先污染全局 heal
    let hookFired = false;
    registerAtomHook({
      atomType: 'heal',
      onAfter: () => { hookFired = true; },
    });

    const globalBefore = getDefaultHookRegistry().getByAtomType('heal').length;
    expect(globalBefore).toBeGreaterThan(0);

    // 清理
    engine.clearForTest();

    // 全局 heal hooks 应被清空
    const globalAfter = getDefaultHookRegistry().getByAtomType('heal').length;
    expect(globalAfter).toBe(0);

    // engine 的 v3 技能钩子总数应保持
    const allAtomTypes = ['damage', 'useCard', 'becomeTarget', 'resolveCard', 'heal', 'draw', 'moveCard', 'specifyTarget'];
    let totalAfter = 0;
    for (const t of allAtomTypes) {
      totalAfter += engine.hooks.getByAtomType(t).length;
    }
    expect(totalAfter).toBeGreaterThan(0);
  });
});
