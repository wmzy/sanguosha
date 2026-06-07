// engine/skills/daqi.ts — 大雾（神诸葛亮技能）v3 registerAtomHook 实现
//
// 神诸葛亮"大雾"标记：防止受到的所有非雷电伤害（normal + fire cancel，thunder 穿透）。
//
// v3 路径：监听 `damage` 原子。目标 = 装备.防具 === '大雾' + damageType ∈ {normal, fire}
// → 取消该 atom（不 apply、不写 serverLog）；thunder 穿透。
//
// 大雾为 Mark-style 技能（不是装备），本 Task 走 fixture 模拟
// "目标拥有大雾 = equipment.防具 === '大雾'"——与藤甲对称实现。
//
// TODO(P1-D): migrate to armorEffect — 当前 armorId 字面量 '大雾'
// 应当由 cardId '大雾' 经 P1-D 装备 barrel 解析得到。

import type { HookRegistry } from '../skill-hook';
import type { SkillDef } from '../types';
import { registerArmorDamageBlockExcept } from './_armorDamageBlock';

export const skills: SkillDef[] = [
  {
    id: '大雾',
    name: '大雾',
    description:
      '神诸葛亮"大雾"标记：防止受到的所有非雷电伤害（normal + fire cancel，thunder 穿透）。',
    // v3-only skill：使用占位 trigger event 字符串 'v3HookOnly'。
    // 详见 wansha.ts 头部注释（保持 state.triggers 命中，v2 emitEvent 永不触发）
    trigger: { event: 'v3HookOnly', source: '装备' },
    handler() {
      return [];
    },
    registerHooks(registry: HookRegistry) {
      // 大雾防 normal + fire（thunder 穿透）
      registerArmorDamageBlockExcept(registry, '大雾', 'thunder');
    },
  },
];
