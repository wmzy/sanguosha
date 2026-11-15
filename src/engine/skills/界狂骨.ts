// 界狂骨(界魏延·被动可选技):当你对一名角色每造成1点伤害时,若你与其距离不大于 1,
// 你可以回复 1 点体力或摸一张牌(按伤害点数逐点发动,2点伤害可发动两次)。
//
// 与标版狂骨差异(经工厂参数注入):
//   - 询问文案前缀 '界狂骨'(requestType/localVars 键同为 界狂骨/ 前缀,键空间隔离)。
//   - 满血时「回复体力」按钮禁用(confirmDisabled),玩家只能摸牌(标版无此禁用)。
//
// 主流程/respond 复用标版狂骨导出的 createKuangguSkill 工厂
// (被动 after-hook + 两步 respond,同反馈/制霸模式)。
//
// 距离 1 以内:effectiveDistance 最小为 1(座位相邻或自己),<= 1 即满足。
// 装备 -1 马(进攻修正)通过 player.vars['距离/进攻修正'] 进一步缩短距离——自动支持。
import { createKuangguSkill, type KuangguOptions } from './狂骨';

const OPTIONS: KuangguOptions = {
  name: '界狂骨',
  description: '对距离1以内的角色每造成1点伤害时,你可以回复1点体力或摸一张牌',
  skillId: '界狂骨',
  displayName: '界狂骨',
  disableHealWhenFull: true,
};

export const { createSkill, onInit, onMount } = createKuangguSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
