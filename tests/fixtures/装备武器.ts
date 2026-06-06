// tests/fixtures/装备武器.ts — 注册仁王盾/丈八蛇矛/方天画戟 v3 registerAtomHook 钩子
//
// 装备技能不通过 engine/skills/index.ts 启动（不属于角色技能），
// 由测试按需通过 fixture 引入注册。
//
// 暴露 `registerAll` 函数供测试在 beforeEach 中调用（先 clearAtomHooks() 后 registerAll），
// 避免模块级副作用被 beforeEach 清空后丢失。

import { register as registerRenwang } from '@engine/skills/renwang';
import { register as registerZhangba } from '@engine/skills/zhangba';
import { register as registerFangtian } from '@engine/skills/fangtian';

export function registerAll(): void {
  registerRenwang();
  registerZhangba();
  registerFangtian();
}
