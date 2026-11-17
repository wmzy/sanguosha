// 界涅槃(界庞统·限定技):当你处于濒死状态时,你可以弃置所有牌,
//   复原你的武将牌,摸三张牌,回复至3点体力,然后获得"八阵""火计""看破"中的一个。
//
// OL 官方(hero)逐字:
//   "限定技,当你处于濒死状态时,你可以:弃置所有牌,复原你的武将牌,摸三张牌,
//    回复至3点体力,然后获得"八阵""火计""看破"中的一个。"
//
// 与标涅槃区别:
//   - 标版止于"回复至3点体力";界版新增"然后获得八阵/火计/看破中的一个"(三选一)。
//
// 实现/交互复用标版涅槃导出的 createNiepanSkill 工厂,仅注入差异:
//   - 键空间按技能 id '界涅槃' 隔离(界涅槃/confirm、界涅槃/confirmed、界涅槃/used)。
//   - 濒死确认/不匹配文案逐字注入;三选一候选注入 choosableSkills(顺序 confirm 询问,
//     官方"获得八阵/火计/看破中的一个";参考 化身.ts 的 respond{skill} 模式不适用于
//     前端 confirm 只发 choice 布尔的约束,故用顺序 confirm)。
import { createNiepanSkill, type NiepanOptions } from './涅槃';
import type { SkillModule } from '../types';

/** 界涅槃三选一候选技能(OL 官方) */
const CHOOSABLE_SKILLS = ['八阵', '火计', '看破'];

const OPTIONS: NiepanOptions = {
  skillId: '界涅槃',
  displayName: '界涅槃',
  description:
    '限定技:濒死时弃置所有牌,复原武将牌,摸三张并回复至3点体力,然后获得八阵/火计/看破中的一个',
  mismatchError: '当前不是界涅槃询问',
  confirmTitle: '是否发动界涅槃?(限定技:弃所有牌,摸3张,回复至3体力,获八阵/火计/看破之一)',
  mountTitle: '是否发动界涅槃?',
  choosableSkills: CHOOSABLE_SKILLS,
};

export const { createSkill, onInit, onMount } = createNiepanSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
