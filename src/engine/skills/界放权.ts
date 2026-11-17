// 界放权(界刘禅·主动技):你可以跳过出牌阶段,然后弃牌阶段开始时,
// 你可以弃置一张手牌并令一名其他角色进行一个额外回合。
//
// 实现/交互复用标版放权导出的 createFangquanSkill 工厂,仅注入差异:
//   - requestType 前缀 = 技能 id '界放权'(前端 resolvePendingRespond 按
//     requestType 前缀解析 skillId 后提交 respond;早期从放权.ts 复制常量时
//     误用 '放权' 前缀,前缀≠技能 id 则 dispatch 找不到 respond handler,
//     按钮不可点击)。
//   - localVars key 仍用 '放权/' 前缀(内部状态,不参与前端路由,保持与测试断言一致)。
//   - 代价(弃一张手牌)+ 选额外回合目标的时机 = 弃牌阶段开始时
//     (costAtDiscardPhase;标版在回合结束时)。
//
// 注:额外回合目标仅限其他角色(本实现不采用官方界限突破的"可为自己"设定)。
import { createFangquanSkill, type FangquanOptions } from './放权';
import type { SkillModule } from '../types';

const OPTIONS: FangquanOptions = {
  skillId: '界放权',
  displayName: '界放权',
  description: '跳过出牌阶段,弃牌阶段开始时弃一张手牌,令一名其他角色进行一个额外回合',
  triggerTitle: '是否发动放权?(跳过出牌阶段,弃牌阶段开始时弃一张手牌令一名角色额外回合)',
  mountTitle: '是否发动界放权?',
  costAtDiscardPhase: true,
};

export const { createSkill, onInit, onMount } = createFangquanSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
