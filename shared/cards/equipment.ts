import type { CardDef } from '../types';

export const 诸葛连弩: CardDef = {
  name: '诸葛连弩', type: '装备牌', subtype: '武器',
  targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] },
  range: 1, weaponEffect: { type: '诸葛连弩' },
};

export const 青釭剑: CardDef = {
  name: '青釭剑', type: '装备牌', subtype: '武器',
  targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] },
  range: 2, weaponEffect: { type: '青釭剑' },
};

export const 雌雄双股剑: CardDef = {
  name: '雌雄双股剑', type: '装备牌', subtype: '武器',
  targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] },
  range: 2, weaponEffect: { type: '雌雄双股剑' },
};

export const 贯石斧: CardDef = {
  name: '贯石斧', type: '装备牌', subtype: '武器',
  targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] },
  range: 3, weaponEffect: { type: '贯石斧' },
};

export const 青龙偃月刀: CardDef = {
  name: '青龙偃月刀', type: '装备牌', subtype: '武器',
  targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] },
  range: 3, weaponEffect: { type: '青龙偃月刀' },
};

export const 丈八蛇矛: CardDef = {
  name: '丈八蛇矛', type: '装备牌', subtype: '武器',
  targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] },
  range: 3,
};

export const 方天画戟: CardDef = {
  name: '方天画戟', type: '装备牌', subtype: '武器',
  targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] },
  range: 4,
};

export const 麒麟弓: CardDef = {
  name: '麒麟弓', type: '装备牌', subtype: '武器',
  targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] },
  range: 5,
};

export const 八卦阵: CardDef = {
  name: '八卦阵', type: '装备牌', subtype: '防具',
  targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] },
  armorEffect: { type: '八卦阵' },
};

export const 仁王盾: CardDef = {
  name: '仁王盾', type: '装备牌', subtype: '防具',
  targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] },
  armorEffect: { type: '仁王盾' },
};

export const 赤兔: CardDef = { name: '赤兔', type: '装备牌', subtype: '进攻马', targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] } };
export const 紫骍: CardDef = { name: '紫骍', type: '装备牌', subtype: '进攻马', targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] } };
export const 大宛: CardDef = { name: '大宛', type: '装备牌', subtype: '进攻马', targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] } };
export const 的卢: CardDef = { name: '的卢', type: '装备牌', subtype: '防御马', targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] } };
export const 绝影: CardDef = { name: '绝影', type: '装备牌', subtype: '防御马', targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] } };
export const 爪黄飞电: CardDef = { name: '爪黄飞电', type: '装备牌', subtype: '防御马', targetFilter: { type: 'none' }, effect: { type: 'sequence', steps: [] } };

export const 武器列表 = [诸葛连弩, 青釭剑, 雌雄双股剑, 贯石斧, 青龙偃月刀, 丈八蛇矛, 方天画戟, 麒麟弓];
export const 防具列表 = [八卦阵, 仁王盾];
export const 马列表 = [赤兔, 紫骍, 大宛, 的卢, 绝影, 爪黄飞电];
export const 装备牌列表 = [...武器列表, ...防具列表, ...马列表];
