// engine/skills/daqi.ts — 大雾（神诸葛亮技能）v3 registerAtomHook 实现
//
// 神诸葛亮"大雾"标记：防止受到的所有非雷电伤害。
//
// v3 路径（Task 2 范围）：监听 `damage` 原子。目标 = 装备.armor === 'daqi' + damageType === 'thunder'
// → 取消该 atom（不 apply、不写 serverLog）。
//
// 注：本 Task 仅实现 thunder 免疫 v3 钩子骨架。完整大雾"非雷电全部防止"
// 涉及 chained 状态（[T-12] P1-B），留 P1-B 一并实现。
// 大雾为 Mark-style 技能（不是装备），本 Task 走 fixture 模拟
// "目标拥有大雾 = equipment.armor === 'daqi'"——与藤甲对称实现。
//
// TODO(P1-D): migrate to armorEffect — 当前 armorId 字面量 'daqi'
// 应当由 cardId '大雾' 经 P1-D 装备 barrel 解析得到。
// TODO(P1-B): complete rule — 真实规则是"非雷电伤害防止"（normal + fire 均免疫），
// 当前实现仅 cancel thunder；non-thunder 路径依赖 chained 状态，留 P1-B 一并实现。

import { registerArmorDamageBlock } from './_armorDamageBlock';

export function register(): void {
  registerArmorDamageBlock('daqi', 'thunder');
}
