// tests/fixtures/雷击.ts — 注册雷击（张角）v3 registerAtomHook 钩子
//
// 角色技能（张角）通常由 @engine/skills/qun.ts 自动注册；但 v3 钩子
// 走 fixture 按需注册，遵循"测试隔离 + 不污染全局技能注册表"模式。
// 暴露 `registerAll` 函数供测试在 beforeEach 中调用（先 clearAtomHooks()
// 后 registerAll），避免模块级副作用被 beforeEach 清空后丢失。

import { getDefaultHookRegistry } from '@engine/skill-hook';
import { skills } from '@engine/equipment/leiji';

export function registerAll(): void {
  const registry = getDefaultHookRegistry();
  for (const skill of skills) {
    skill.registerHooks?.(registry);
  }
}
