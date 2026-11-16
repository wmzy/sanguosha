import type { CardDef } from '../../types';

/** 装备牌样板工厂:装备牌均无使用目标、无主动使用效果(效果由 skills/ 按 card.name 挂载),
 *  故统一 targetFilter none + 空 sequence;武器 range/weaponEffect、防具 armorEffect、
 *  诸葛连弩/方天画戟 的特有字段经 extra 传入。 */
const equipCard = (
  name: string,
  subtype: CardDef['subtype'],
  extra?: Partial<Omit<CardDef, 'name' | 'type' | 'subtype' | 'targetFilter' | 'effect'>>,
): CardDef => ({
  name,
  type: '装备牌',
  subtype,
  targetFilter: { type: 'none' },
  effect: { type: 'sequence', steps: [] },
  ...extra,
});

export const 诸葛连弩: CardDef = equipCard('诸葛连弩', '武器', {
  range: 1,
  weaponEffect: { type: '诸葛连弩' },
  slashUnlimited: true,
});

export const 青釭剑: CardDef = equipCard('青釭剑', '武器', {
  range: 2,
  weaponEffect: { type: '青釭剑' },
});

export const 寒冰剑: CardDef = equipCard('寒冰剑', '武器', {
  range: 2,
  weaponEffect: { type: '寒冰剑' },
});

export const 雌雄双股剑: CardDef = equipCard('雌雄双股剑', '武器', {
  range: 2,
  weaponEffect: { type: '雌雄双股剑' },
});

export const 贯石斧: CardDef = equipCard('贯石斧', '武器', {
  range: 3,
  weaponEffect: { type: '贯石斧' },
});

export const 青龙偃月刀: CardDef = equipCard('青龙偃月刀', '武器', {
  range: 3,
  weaponEffect: { type: '青龙偃月刀' },
});

export const 丈八蛇矛: CardDef = equipCard('丈八蛇矛', '武器', { range: 3 });

export const 方天画戟: CardDef = equipCard('方天画戟', '武器', {
  range: 4,
  slashTargetBonusWhenLastCard: 3,
});

export const 麒麟弓: CardDef = equipCard('麒麟弓', '武器', { range: 5 });

export const 八卦阵: CardDef = equipCard('八卦阵', '防具', {
  armorEffect: { type: '八卦阵' },
});

export const 仁王盾: CardDef = equipCard('仁王盾', '防具', {
  armorEffect: { type: '仁王盾' },
});

// ─── 军争篇装备牌 ──────────────────────────────────────────
// 藤甲 / 白银狮子 / 古锭刀 / 朱雀羽扇 / 骅骝 的特殊技已在 engine/skills/ 中实现
// (按 card.name 动态挂载),这里仅补 CardDef 声明,使牌堆能生成这些牌。
// 骅骝 为防御马,距离修正技走 skills/马匹技能.ts 工厂(见 card-meta.ts)。

export const 藤甲: CardDef = equipCard('藤甲', '防具', {
  armorEffect: { type: '藤甲' },
});

export const 白银狮子: CardDef = equipCard('白银狮子', '防具', {
  armorEffect: { type: '白银狮子' },
});

export const 古锭刀: CardDef = equipCard('古锭刀', '武器', { range: 2 });

export const 朱雀羽扇: CardDef = equipCard('朱雀羽扇', '武器', { range: 4 });

export const 骅骝: CardDef = equipCard('骅骝', '防御马');

export const 赤兔: CardDef = equipCard('赤兔', '进攻马');
export const 紫骍: CardDef = equipCard('紫骍', '进攻马');
export const 大宛: CardDef = equipCard('大宛', '进攻马');
export const 的卢: CardDef = equipCard('的卢', '防御马');
export const 绝影: CardDef = equipCard('绝影', '防御马');
export const 爪黄飞电: CardDef = equipCard('爪黄飞电', '防御马');

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

/** 马匹距离修正表(skillId → 距离增量),供 添加技能/移除技能 atom 的 toViewEvents 同步。
 *  从 CardDef.subtype 派生:进攻马→attackMod,防御马→defenseMod。
 *  替代旧 registerSkillViewDelta 运行时注册(消除模块级可变 Map + 副作用 import)。 */
export const 马匹距离修正表: ReadonlyMap<string, { attackMod?: number; defenseMod?: number }> = new Map(
  马列表.map((c) => [c.name, c.subtype === '进攻马' ? { attackMod: 1 } : { defenseMod: 1 }]),
);

/** 装备技能模块例外表(卡名 → moduleSpec,见 skills/registry.ts)。
 *  马匹技能为工厂模块:7 匹马共享 skills/马匹技能.ts,按卡名取命名导出('#名字' 语法)。
 *  其余装备(武器/防具)技能名与文件名一致,走 registry 的缺省规则,无需在此列出。
 *  从 马列表 派生,新增马匹零维护。 */
export const EQUIPMENT_SKILL_MODULE_SPECS: Readonly<Record<string, string>> = Object.fromEntries(
  马列表.map((c) => [c.name, `skills/马匹技能#${c.name}`]),
);
