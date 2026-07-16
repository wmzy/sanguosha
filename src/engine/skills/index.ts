// src/engine/skills/index.ts
// 技能模块懒加载表：通过 import() 按需加载。
// 动态加载是合理的：每局游戏只选 4 个武将 +部分装备，不需要全量加载 37 个模块。
import type { SkillModule } from '../skill';
import { setSkillModuleResolver, setSkillModuleChecker } from '../skill';

// 注意:系统规则的全局 hooks 不再在模块加载时注册(state-bound 注册表要求绑定到具体 state)。
// 改由 create-engine 的 bootstrap / registerSkillsFromState 对每个真实 state 调用 系统规则.onInit 注册。

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
  开局: load(() => import('./开局')),
  杀: load(() => import('./杀')),
  闪: load(() => import('./闪')),
  桃: load(() => import('./桃')),
  酒: load(() => import('./酒')),
  仁德: load(() => import('./仁德')),
  激将: load(() => import('./激将')),
  护甲: load(() => import('./护甲')),
  制衡: load(() => import('./制衡')),
  救援: load(() => import('./救援')),
  武圣: load(() => import('./武圣')),
  义绝: load(() => import('./义绝')),
  遗计: load(() => import('./遗计')),
  天妒: load(() => import('./天妒')),
  奸雄: load(() => import('./奸雄')),
  护驾: load(() => import('./护驾')),
  突袭: load(() => import('./突袭')),
  回合管理: load(() => import('./回合管理')),
  八卦阵: load(() => import('./八卦阵')),
  流离: load(() => import('./流离')),
  南蛮入侵: load(() => import('./南蛮入侵')),
  万箭齐发: load(() => import('./万箭齐发')),
  决斗: load(() => import('./决斗')),
  反馈: load(() => import('./反馈')),
  刚烈: load(() => import('./刚烈')),
  倾国: load(() => import('./倾国')),
  洛神: load(() => import('./洛神')),
  神速: load(() => import('./神速')),
  据守: load(() => import('./据守')),
  裸衣: load(() => import('./裸衣')),
  强袭: load(() => import('./强袭')),
  驱虎: load(() => import('./驱虎')),
  节命: load(() => import('./节命')),
  断粮: load(() => import('./断粮')),
  鬼才: load(() => import('./鬼才')),
  行殇: load(() => import('./行殇')),
  放逐: load(() => import('./放逐')),
  颂威: load(() => import('./颂威')),
  巧变: load(() => import('./巧变')),
  屯田: load(() => import('./屯田')),
  凿险: load(() => import('./凿险')),
  急袭: load(() => import('./急袭')),
  // 蜀国武将技
  挑衅: load(() => import('./挑衅')),
  享乐: load(() => import('./享乐')),
  祸首: load(() => import('./祸首')),
  咆哮: load(() => import('./咆哮')),
  马术: load(() => import('./马术')),
  龙胆: load(() => import('./龙胆')),
  涯角: load(() => import('./涯角')),
  铁骑: load(() => import('./铁骑')),
  观星: load(() => import('./观星')),
  空城: load(() => import('./空城')),
  巨象: load(() => import('./巨象')),
  烈刃: load(() => import('./烈刃')),
  志继: load(() => import('./志继')),
  若愚: load(() => import('./若愚')),
  连环: load(() => import('./连环')),
  涅槃: load(() => import('./涅槃')),
  烈弓: load(() => import('./烈弓')),
  狂骨: load(() => import('./狂骨')),
  集智: load(() => import('./集智')),
  奇才: load(() => import('./奇才')),
  // 界限突破·蜀国武将技(独立技能文件,不修改标技能)
  界铁骑: load(() => import('./界铁骑')),
  界狂骨: load(() => import('./界狂骨')),
  界咆哮: load(() => import('./界咆哮')),
  界集智: load(() => import('./界集智')),
  界奇才: load(() => import('./界奇才')),
  界武圣: load(() => import('./界武圣')),
  界仁德: load(() => import('./界仁德')),
  界放权: load(() => import('./界放权')),
  界志继: load(() => import('./界志继')),
  界空城: load(() => import('./界空城')),
  界烈弓: load(() => import('./界烈弓')),
  界再起: load(() => import('./界再起')),
  // 武器
  诸葛连弩: load(() => import('./诸葛连弩')),
  青釭剑: load(() => import('./青釭剑')),
  青龙偃月刀: load(() => import('./青龙偃月刀')),
  雌雄双股剑: load(() => import('./雌雄双股剑')),
  贯石斧: load(() => import('./贯石斧')),
  丈八蛇矛: load(() => import('./丈八蛇矛')),
  方天画戟: load(() => import('./方天画戟')),
  寒冰剑: load(() => import('./寒冰剑')),
  麒麟弓: load(() => import('./麒麟弓')),
  // 防具/延时锦囊
  仁王盾: load(() => import('./仁王盾')),
  藤甲: load(() => import('./藤甲')),
  白银狮子: load(() => import('./白银狮子')),
  乐不思蜀: load(() => import('./乐不思蜀')),
  兵粮寸断: load(() => import('./兵粮寸断')),
  闪电: load(() => import('./闪电')),
  // 马匹(进攻马/防御马):效果=距离修正,与马术等技能统一走 vars
  赤兔: () => import('./马匹技能').then((m) => m.赤兔),
  紫骍: () => import('./马匹技能').then((m) => m.紫骍),
  大宛: () => import('./马匹技能').then((m) => m.大宛),
  的卢: () => import('./马匹技能').then((m) => m.的卢),
  绝影: () => import('./马匹技能').then((m) => m.绝影),
  爪黄飞电: () => import('./马匹技能').then((m) => m.爪黄飞电),
  // 即时锦囊
  过河拆桥: load(() => import('./过河拆桥')),
  顺手牵羊: load(() => import('./顺手牵羊')),
  无中生有: load(() => import('./无中生有')),
  桃园结义: load(() => import('./桃园结义')),
  五谷丰登: load(() => import('./五谷丰登')),
  借刀杀人: load(() => import('./借刀杀人')),
  无懈可击: load(() => import('./无懈可击')),
  铁索连环: load(() => import('./铁索连环')),
  火攻: load(() => import('./火攻')),
  再起: load(() => import('./再起')),
  苦肉: load(() => import('./苦肉')),
  放权: load(() => import('./放权')),
  // 吴国·甘宁
  奇袭: load(() => import('./奇袭')),
  // 吴国·吕蒙
  克己: load(() => import('./克己')),
  // 吴国·大乔
  国色: load(() => import('./国色')),
  // 吴国·陆逊
  谦逊: load(() => import('./谦逊')),
  连营: load(() => import('./连营')),
  // 吴国·张昭张纮
  直谏: load(() => import('./直谏')),
  固政: load(() => import('./固政')),
  // 吴国·孙坚
  英魂: load(() => import('./英魂')),
  // 吴国·孙策
  激昂: load(() => import('./激昂')),
  魂姿: load(() => import('./魂姿')),
  制霸: load(() => import('./制霸')),
  // 吴国·孙尚香
  结姻: load(() => import('./结姻')),
  枭姬: load(() => import('./枭姬')),
  // 吴国·周泰
  不屈: load(() => import('./不屈')),
  // 吴国·太史慈
  天义: load(() => import('./天义')),
  // 吴国·周瑜
  英姿: load(() => import('./英姿')),
  反间: load(() => import('./反间')),
  // 吴国·鲁肃
  好施: load(() => import('./好施')),
  缔盟: load(() => import('./缔盟')),
  // 吴国·小乔
  天香: load(() => import('./天香')),
  红颜: load(() => import('./红颜')),
  // 群雄·袁绍
  乱击: load(() => import('./乱击')),
  无双: load(() => import('./无双')),
  // 群雄·颜良文丑
  双雄: load(() => import('./双雄')),
  // 群雄·庞德
  鞬出: load(() => import('./鞬出')),
  // 群雄·貂蝉
  离间: load(() => import('./离间')),
  闭月: load(() => import('./闭月')),
  // 群雄·华佗
  急救: load(() => import('./急救')),
  青囊: load(() => import('./青囊')),
  // 群雄·董卓
  酒池: load(() => import('./酒池')),
  肉林: load(() => import('./肉林')),
  崩坏: load(() => import('./崩坏')),
  暴虐: load(() => import('./暴虐')),
  // 群雄·蔡文姬
  悲歌: load(() => import('./悲歌')),
  断肠: load(() => import('./断肠')),
  // 群雄·贾诩
  完杀: load(() => import('./完杀')),
  乱武: load(() => import('./乱武')),
  帷幕: load(() => import('./帷幕')),
  // 群雄·张角
  雷击: load(() => import('./雷击')),
  鬼道: load(() => import('./鬼道')),
  黄天: load(() => import('./黄天')),
  // 蜀国·卧龙诸葛
  八阵: load(() => import('./八阵')),
  火计: load(() => import('./火计')),
  看破: load(() => import('./看破')),
  // 通用
  装备通用: load(() => import('./装备通用')),
  // 群雄·左慈
  化身: load(() => import('./化身')),
  新生: load(() => import('./新生')),
  // 群雄·于吉
  蛊惑: load(() => import('./蛊惑')),
};

// 设置解析器(打破循环依赖:技能文件 import skill.ts → skill.ts 通过 resolver 查表)
setSkillModuleResolver(async (id: string): Promise<SkillModule> => {
  const loader = skillLoaders[id];
  if (!loader) throw new Error(`Skill module "${id}" not found in skillLoaders`);
  return loader();
});

// 同步检查器:供 instantiateSkill 在 await 前判断模块是否存在,避免 try-catch 控制流
setSkillModuleChecker((id: string): boolean => id in skillLoaders);

// 系统规则的全局 hooks 已移至 create-engine 的 bootstrap/registerSkillsFromState 中,
// 对每个真实 state 调用 系统规则.onInit(state) 注册(state-bound 注册表要求)。
