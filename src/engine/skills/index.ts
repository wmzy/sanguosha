// src/engine/skills/index.ts
// 技能模块懒加载表：通过 import() 按需加载。
// 动态加载是合理的：每局游戏只选 4 个武将 +部分装备，不需要全量加载 37 个模块。
import type { SkillModule } from '../skill';
import { setSkillModuleResolver } from '../skill';
// 系统规则是全局 hooks(判定清理/技能生命周期/濒死),import 时立即注册
import { onInit as init系统规则 } from './系统规则';

type Loader = () => Promise<SkillModule>;

/** 从动态 import 的模块中提取 SkillModule 字段(命名导出) */
function load(importer: () => Promise<Record<string, unknown>>): Loader {
  return async () => {
    const m = await importer();
    return m as unknown as SkillModule;
  };
}

export const skillLoaders: Record<string, Loader> = {
  // 基础
  '开局': load(() => import('./开局')),
  '杀': load(() => import('./杀')),
  '闪': load(() => import('./闪')),
  '桃': load(() => import('./桃')),
  '酒': load(() => import('./酒')),
  '仁德': load(() => import('./仁德')),
  '激将': load(() => import('./激将')),
  '护甲': load(() => import('./护甲')),
  '制衡': load(() => import('./制衡')),
  '武圣': load(() => import('./武圣')),
  '遗计': load(() => import('./遗计')),
  '回合管理': load(() => import('./回合管理')),
  '八卦阵': load(() => import('./八卦阵')),
  '流离': load(() => import('./流离')),
  '南蛮入侵': load(() => import('./南蛮入侵')),
  '万箭齐发': load(() => import('./万箭齐发')),
  '决斗': load(() => import('./决斗')),
  '反馈': load(() => import('./反馈')),
  // 武器
  '诸葛连弩': load(() => import('./诸葛连弩')),
  '青釭剑': load(() => import('./青釭剑')),
  '青龙偃月刀': load(() => import('./青龙偃月刀')),
  '雌雄双股剑': load(() => import('./雌雄双股剑')),
  '贯石斧': load(() => import('./贯石斧')),
  '丈八蛇矛': load(() => import('./丈八蛇矛')),
  '方天画戟': load(() => import('./方天画戟')),
  '寒冰剑': load(() => import('./寒冰剑')),
  // 防具/延时锦囊
  '仁王盾': load(() => import('./仁王盾')),
  '藤甲': load(() => import('./藤甲')),
  '白银狮子': load(() => import('./白银狮子')),
  '乐不思蜀': load(() => import('./乐不思蜀')),
  // 马匹(进攻马/防御马):效果=距离修正,与马术等技能统一走 vars
  '赤兔': () => import('./马匹技能').then(m => m.赤兔),
  '紫骍': () => import('./马匹技能').then(m => m.紫骍),
  '大宛': () => import('./马匹技能').then(m => m.大宛),
  '的卢': () => import('./马匹技能').then(m => m.的卢),
  '绝影': () => import('./马匹技能').then(m => m.绝影),
  '爪黄飞电': () => import('./马匹技能').then(m => m.爪黄飞电),
  // 即时锦囊
  '过河拆桥': load(() => import('./过河拆桥')),
  '顺手牵羊': load(() => import('./顺手牵羊')),
  '无中生有': load(() => import('./无中生有')),
  '桃园结义': load(() => import('./桃园结义')),
  '借刀杀人': load(() => import('./借刀杀人')),
  '无懈可击': load(() => import('./无懈可击')),
  // 通用
  '装备通用': load(() => import('./装备通用')),
};

// 设置解析器(打破循环依赖:技能文件 import skill.ts → skill.ts 通过 resolver 查表)
setSkillModuleResolver(async (id: string): Promise<SkillModule> => {
  const loader = skillLoaders[id];
  if (!loader) throw new Error(`Skill module "${id}" not found in skillLoaders`);
  return loader();
});

// 系统规则是全局 hooks,模块加载时立即注册
init系统规则({ id: '系统规则', ownerId: -1, name: '系统规则', description: '' }, -1);
