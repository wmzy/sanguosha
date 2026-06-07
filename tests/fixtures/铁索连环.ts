// tests/fixtures/铁索连环.ts — 注册铁索连环（chained 传导）v3 registerAtomHook 钩子
//
// 铁索连环是装备/锦囊效果，不属于角色技能——不通过 engine/skills/index.ts 启动。
// 由测试按需通过 fixture 引入注册。
//
// 暴露 `registerAll` 函数供测试在 beforeEach 中调用（先 clearAtomHooks() 后 registerAll），
// 避免模块级副作用被 beforeEach 清空后丢失。

import { getDefaultHookRegistry } from '@engine/skill-hook';
import { register } from '@engine/equipment/chained-propagation';

export function registerAll(): void {
  register(getDefaultHookRegistry());
}
