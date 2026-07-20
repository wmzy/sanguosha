import type { CardDef } from '../types';

export const 诸葛连弩: CardDef = {
  name: '诸葛连弩',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 1,
  weaponEffect: { type: '诸葛连弩' },
};

export const 青釭剑: CardDef = {
  name: '青釭剑',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 2,
  weaponEffect: { type: '青釭剑' },
};

export const 寒冰剑: CardDef = {
  name: '寒冰剑',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 2,
  weaponEffect: { type: '寒冰剑' },
};

export const 雌雄双股剑: CardDef = {
  name: '雌雄双股剑',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 2,
  weaponEffect: { type: '雌雄双股剑' },
};

export const 贯石斧: CardDef = {
  name: '贯石斧',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 3,
  weaponEffect: { type: '贯石斧' },
};

export const 青龙偃月刀: CardDef = {
  name: '青龙偃月刀',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 3,
  weaponEffect: { type: '青龙偃月刀' },
};

export const 丈八蛇矛: CardDef = {
  name: '丈八蛇矛',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 3,
};

export const 方天画戟: CardDef = {
  name: '方天画戟',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 4,
};

export const 麒麟弓: CardDef = {
  name: '麒麟弓',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 5,
};

export const 八卦阵: CardDef = {
  name: '八卦阵',
  type: '装备牌',
  subtype: '防具',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  armorEffect: { type: '八卦阵' },
};

export const 仁王盾: CardDef = {
  name: '仁王盾',
  type: '装备牌',
  subtype: '防具',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  armorEffect: { type: '仁王盾' },
};

// ─── 军争篇装备牌 ──────────────────────────────────────────
// 藤甲 / 白银狮子 的防具技已在 engine/skills/ 中实现(按 card.name 动态挂载),
// 这里仅补 CardDef 声明,使牌堆能生成这两张牌。
// 古锭刀 / 朱雀羽扇 / 骅骝 的特殊技尚未实现,暂作为仅提供射程/槽位的占位装备
// (与 丈八蛇矛 / 方天画戟 现状一致:有 range,无 weaponEffect)。
// 将来实现其技能时,在 engine/skills/ 新增同名模块即可自动挂载(见 card-meta.ts)。

export const 藤甲: CardDef = {
  name: '藤甲',
  type: '装备牌',
  subtype: '防具',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  armorEffect: { type: '藤甲' },
};

export const 白银狮子: CardDef = {
  name: '白银狮子',
  type: '装备牌',
  subtype: '防具',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  armorEffect: { type: '白银狮子' },
};

export const 古锭刀: CardDef = {
  name: '古锭刀',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 2,
};

export const 朱雀羽扇: CardDef = {
  name: '朱雀羽扇',
  type: '装备牌',
  subtype: '武器',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  range: 4,
};

export const 骅骝: CardDef = {
  name: '骅骝',
  type: '装备牌',
  subtype: '防御马',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
};

export const 赤兔: CardDef = {
  name: '赤兔',
  type: '装备牌',
  subtype: '进攻马',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
};
export const 紫骍: CardDef = {
  name: '紫骍',
  type: '装备牌',
  subtype: '进攻马',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
};
export const 大宛: CardDef = {
  name: '大宛',
  type: '装备牌',
  subtype: '进攻马',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
};
export const 的卢: CardDef = {
  name: '的卢',
  type: '装备牌',
  subtype: '防御马',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
};
export const 绝影: CardDef = {
  name: '绝影',
  type: '装备牌',
  subtype: '防御马',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
};
export const 爪黄飞电: CardDef = {
  name: '爪黄飞电',
  type: '装备牌',
  subtype: '防御马',
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
};

export const 武器列表 = [
  诸葛连弩,
  青釭剑,
  寒冰剑,
  雌雄双股剑,
  贯石斧,
  青龙偃月刀,
  丈八蛇矛,
  方天画戟,
  麒麟弓,
  古锭刀,
  朱雀羽扇,
];
export const 防具列表 = [八卦阵, 仁王盾, 藤甲, 白银狮子];
export const 马列表 = [赤兔, 紫骍, 大宛, 的卢, 绝影, 爪黄飞电, 骅骝];
export const 装备牌列表 = [...武器列表, ...防具列表, ...马列表];
