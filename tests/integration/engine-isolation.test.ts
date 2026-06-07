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

describe('多 engine 实例钩子互不干扰', () => {
  it('engine1 注册的私有 hook 不会出现在 engine2 闭包', () => {
    const engine1 = createTestEngine();
    const engine2 = createTestEngine();

    // 在 engine1 闭包注册一个独特 hook
    engine1.hooks.register({
      atomType: 'useCard',
      onAfter: () => {},
    });

    // engine2 闭包不应有 engine1 的额外 hook
    expect(engine2.hooks.getByAtomType('useCard').length).toBeLessThan(
      engine1.hooks.getByAtomType('useCard').length
    );
  });

  it('clearForTest 不影响其他 instance 的闭包 hooks', () => {
    const engine1 = createTestEngine();
    const engine2 = createTestEngine();

    const before2 = engine2.hooks.getByAtomType('useCard').length;

    engine1.clearForTest();

    // engine1 重新注册后闭包 hooks 应恢复到原来
    expect(engine1.hooks.getByAtomType('useCard').length).toBeGreaterThan(0);
    // engine2 闭包不受影响
    expect(engine2.hooks.getByAtomType('useCard').length).toBe(before2);
  });
});
