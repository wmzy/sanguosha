// tests/fixtures/装备武器.ts — 注册仁王盾/丈八蛇矛/方天画戟 v3 registerAtomHook 钩子
//
// 装备技能不通过 engine/skills/index.ts 启动（不属于角色技能），
// 由测试按需通过 fixture 引入注册。
//
// 暴露 `registerAll` 函数供测试在 beforeEach 中调用（先 clearAtomHooks() 后 registerAll），
// 避免模块级副作用被 beforeEach 清空后丢失。

import { getDefaultHookRegistry } from '@engine/skill-hook';
import { skills as renwang } from '@engine/skills/renwang';
import { skills as zhangba } from '@engine/skills/zhangba';
import { skills as fangtian } from '@engine/skills/fangtian';

export function registerAll(): void {
  const registry = getDefaultHookRegistry();
  for (const skill of renwang) skill.registerHooks?.(registry);
  for (const skill of zhangba) skill.registerHooks?.(registry);
  for (const skill of fangtian) skill.registerHooks?.(registry);
}
