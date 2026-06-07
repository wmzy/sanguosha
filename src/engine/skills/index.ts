// engine/skills/index.ts — 技能模块聚合入口
//
// 旧模式：各模块顶层调用 registerSkill()（import 即副作用）。
// 新模式：各模块导出 SkillDef[]，由本文件统一注册。
// v3 registerAtomHook 钩子通过 SkillDef.registerHooks 字段注册到全局 HookRegistry。

import { getDefaultHookRegistry } from '../skill-hook';
import { registerSkill } from '../skill';
import type { SkillDef } from '../types';

// v2 武将技能
import { skills as weiSkills } from './wei';
import { skills as shuSkills } from './shu';
import { skills as wuSkills } from './wu';
import { skills as qunSkills } from './qun';
import { skills as equipmentSkills } from './equipment';

// v3 钩子技能
import { skills as baguaSkills } from './bagua';
import { skills as daqiSkills } from './daqi';
import { skills as fangtianSkills } from './fangtian';
import { skills as kongchengSkills } from './kongcheng';
import { skills as leijiSkills } from './leiji';
import { skills as qinggangSkills } from './qinggang';
import { skills as renwangSkills } from './renwang';
import { skills as tengjiaSkills } from './tengjia';
import { skills as wanshaSkills } from './wansha';
import { skills as weimuSkills } from './weimu';
import { skills as zhangbaSkills } from './zhangba';

/** 所有可用技能定义（纯数据，无副作用） */
export const allSkills: SkillDef[] = [
  ...weiSkills,
  ...shuSkills,
  ...wuSkills,
  ...qunSkills,
  ...equipmentSkills,
  ...baguaSkills,
  ...daqiSkills,
  ...fangtianSkills,
  ...kongchengSkills,
  ...leijiSkills,
  ...qinggangSkills,
  ...renwangSkills,
  ...tengjiaSkills,
  ...wanshaSkills,
  ...weimuSkills,
  ...zhangbaSkills,
];


/**
 * 根据房间配置过滤可用技能。
 * 当前返回全部——后续实现按武将/禁用卡牌/化身池过滤。
 */
export function filterSkills(
  _config: {
    characterIds: string[];
    disabledCardNames?: string[];
    hasHuashen?: boolean;
  },
): SkillDef[] {
  return allSkills;
}
let _initialized = false;

/**
 * 注册所有技能到全局注册表（v2 skill registry + v3 hook registry）。
 * 幂等：多次调用只注册一次。
 * import './skills/index' 时自动调用，保持向后兼容。
 */
export function registerAllSkills(): void {
  if (_initialized) return;
  _initialized = true;

  const hookRegistry = getDefaultHookRegistry();
  const best = new Map<string, SkillDef>();
  for (const skill of allSkills) {
    const existing = best.get(skill.id);
    // 优先保留含 registerHooks 的版本（v3 钩子技能），
    // 跳过同名占位版（equipment.ts 中的 v2 stub）
    if (!existing || skill.registerHooks) {
      best.set(skill.id, skill);
    }
  }
  for (const skill of best.values()) {
    registerSkill(skill);
    skill.registerHooks?.(hookRegistry);
  }
}

// 模块加载时自动注册——保持 import './skills/index' 的副作用语义
registerAllSkills();
