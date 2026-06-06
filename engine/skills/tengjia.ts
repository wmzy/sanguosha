// engine/skills/tengjia.ts — 藤甲（防具）v3 registerAtomHook 实现
//
// 锁定技：装备藤甲的角色受到火焰伤害时，防止此伤害。
//
// v3 路径：监听 `damage` 原子。目标 = 装备.armor === 'tengjia' + damageType === 'fire'
// → 取消该 atom（不 apply、不写 serverLog）。
//
// 注：本 Task 仅实现 v3 钩子骨架，装备注册（cardId 映射、装备区放置）由 P1-D 处理。
// 旧 stub handler 空壳未注册（`engine/skills/equipment.ts` 暂不含 tengjia）。

// TODO(P1-D): migrate to armorEffect — 当前 armorId 字面量 'tengjia'
// 应当由 cardId '藤甲' 经 P1-D 装备 barrel 解析得到，不再是裸字符串。

import { registerArmorDamageBlock } from './_armorDamageBlock';

export function register(): void {
  registerArmorDamageBlock('tengjia', 'fire');
}
