// 界崩坏(界董卓·锁定技,OL 界限突破官方逐字):
//   锁定技,结束阶段,若你不是体力值最小的角色,你失去1点体力或减少1点体力上限。
//
// 与标版区别(描述完全相同,但界版可被界酒池第三段效果禁用):
//   - 界酒池"使用酒杀造成伤害后,本回合崩坏失效" → 通过 turn.vars['崩坏/disabled']
//     传递禁用信号。本技能读取该 var,若为 true 则本回合不触发。
//   - 标版崩坏.ts 不读取此 var,故差异经工厂参数 disableCheck 注入(不改标版)。
//
// 主流程/respond/onMount 复用标版崩坏导出的 createBenghuaiSkill 工厂
// (差异仅 询问 requestType/描述/禁用检查;选择键共享 '崩坏/choice'——
//  标/界董卓只会拥有一版崩坏)。
//
// 关键点:
//   - turn.vars['崩坏/disabled'] 由 界酒池 after-hook on '去标记' 写入(酒增伤生效时)
//   - turn.vars 随「回合结束」atom 自动清空(语义贴合"本回合")
import { createBenghuaiSkill, type BenghuaiOptions } from './崩坏';

const DISABLE_VAR = '崩坏/disabled'; // turn.vars:本回合禁用崩坏(由界酒池写入)

const OPTIONS: BenghuaiOptions = {
  description:
    '锁定技:回合结束阶段,若你的体力不是全场最少的,须减1点体力或1点体力上限;界酒池酒杀造成伤害后本回合失效',
  chooseRt: '界崩坏/choose',
  disableCheck: (state) => state.turn.vars[DISABLE_VAR] === true,
};

export const { createSkill, onInit, onMount } = createBenghuaiSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
