// engine/skills/index.ts — 技能模块聚合入口
//
// 旧模式：各模块顶层调用 registerSkill()（import 即副作用）。
// 新模式：各模块导出 SkillDef[]，由本文件统一注册。
// v3 registerAtomHook 钩子通过 SkillDef.registerHooks 字段注册到全局 HookRegistry。

import { getDefaultHookRegistry } from '../skill-hook';
import { registerSkill } from '../skill';
import type { SkillDef } from '../types';

// 魏
import { skills as caocao } from './曹操';
import { skills as simayi } from './司马懿';
import { skills as xiahouDun } from './夏侯惇';
import { skills as zhangLiao } from './张辽';
import { skills as xuChu } from './许褚';
import { skills as guoJia } from './郭嘉';
import { skills as zhenJi } from './甄姬';
import { skills as xiahouYuan } from './夏侯渊';
import { skills as caoRen } from './曹仁';
import { skills as xunYu } from './荀彧';
import { skills as dianWei } from './典韦';
import { skills as caoPi } from './曹丕';
import { skills as xuHuang } from './徐晃';
import { skills as zhangHe } from './张郃';
import { skills as dengAi } from './邓艾';

// 蜀
import { skills as liuBei } from './刘备';
import { skills as guanYu } from './关羽';
import { skills as zhangFei } from './张飞';
import { skills as zhaoYun } from './赵云';
import { skills as zhugeLiang } from './诸葛亮';
import { skills as maChao } from './马超';
import { skills as huangYueYing } from './黄月英';
import { skills as huangZhong } from './黄忠';
import { skills as weiYan } from './魏延';
import { skills as wolong } from './卧龙诸葛';
import { skills as pangTong } from './庞统';
import { skills as mengHuo } from './孟获';
import { skills as zhuRong } from './祝融';
import { skills as jiangWei } from './姜维';
import { skills as liuShan } from './刘禅';

// 吴
import { skills as sunQuan } from './孙权';
import { skills as ganNing } from './甘宁';
import { skills as lvMeng } from './吕蒙';
import { skills as huangGai } from './黄盖';
import { skills as zhouYu } from './周瑜';
import { skills as daQiao } from './大乔';
import { skills as luXun } from './陆逊';
import { skills as sunShangXiang } from './孙尚香';
import { skills as xiaoQiao } from './小乔';
import { skills as zhouTai } from './周泰';
import { skills as taiShiCi } from './太史慈';
import { skills as luSu } from './鲁肃';
import { skills as sunJian } from './孙坚';
import { skills as sunCe } from './孙策';
import { skills as zhangZhaoZhangHong } from './张昭张纮';

// 群
import { skills as lvBu } from './吕布';
import { skills as diaoChan } from './貂蝉';
import { skills as huaTuo } from './华佗';
import { skills as zhangJiao } from './张角';
import { skills as yuJi } from './于吉';
import { skills as yuanShao } from './袁绍';
import { skills as pangDe } from './庞德';
import { skills as yanLiangWenChou } from './颜良文丑';
import { skills as dongZhuo } from './董卓';
import { skills as zuoCi } from './左慈';
import { skills as caiWenJi } from './蔡文姬';

// 装备
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
  // 魏
  ...caocao,
  ...simayi,
  ...xiahouDun,
  ...zhangLiao,
  ...xuChu,
  ...guoJia,
  ...zhenJi,
  ...xiahouYuan,
  ...caoRen,
  ...xunYu,
  ...dianWei,
  ...caoPi,
  ...xuHuang,
  ...zhangHe,
  ...dengAi,
  // 蜀
  ...liuBei,
  ...guanYu,
  ...zhangFei,
  ...zhaoYun,
  ...zhugeLiang,
  ...maChao,
  ...huangYueYing,
  ...huangZhong,
  ...weiYan,
  ...wolong,
  ...pangTong,
  ...mengHuo,
  ...zhuRong,
  ...jiangWei,
  ...liuShan,
  // 吴
  ...sunQuan,
  ...ganNing,
  ...lvMeng,
  ...huangGai,
  ...zhouYu,
  ...daQiao,
  ...luXun,
  ...sunShangXiang,
  ...xiaoQiao,
  ...zhouTai,
  ...taiShiCi,
  ...luSu,
  ...sunJian,
  ...sunCe,
  ...zhangZhaoZhangHong,
  // 群
  ...lvBu,
  ...diaoChan,
  ...huaTuo,
  ...zhangJiao,
  ...yuJi,
  ...yuanShao,
  ...pangDe,
  ...yanLiangWenChou,
  ...dongZhuo,
  ...zuoCi,
  ...caiWenJi,
  // 装备
  ...equipmentSkills,
  // v3 钩子技能
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
