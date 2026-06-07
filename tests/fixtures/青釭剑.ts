// tests/fixtures/青釭剑.ts — 注册青釭剑 v3 registerAtomHook 钩子
//
// 装备技能不通过 engine/skills/index.ts 启动（不属于角色技能），
// 由测试按需通过 fixture 引入注册。
//
// 暴露 `registerAll` 函数供测试在 beforeEach 中调用（先 clearAtomHooks() 后 registerAll），
// 避免模块级副作用被 beforeEach 清空后丢失。

import { getDefaultHookRegistry } from '@engine/skill-hook';
import { skills } from '@engine/skills/qinggang';

export function registerAll(): void {
  const registry = getDefaultHookRegistry();
  for (const skill of skills) {
    skill.registerHooks?.(registry);
  }
}
