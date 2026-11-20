// 界放逐(界曹丕·被动技):当你受到伤害后,你可以令一名其他角色翻面,
//   并令其摸X张牌(X为你已损失体力值)。(官方逐字,界曹丕.md)
//
// 与标版放逐的区别:仅文案细节与结算语序(界版先翻面后摸牌,标版先摸后翻);
// 机制同构——目标真实翻面(跳过下一回合),作为交换摸 X 张牌。
//
// 流程/respond/翻面 hooks/onMount 复用标版放逐导出的 createFangzhuSkill 工厂
// (差异仅 技能名/描述/询问 requestType(界放逐/…)/文案/语序;localVars 确认与目标键、
//  翻面标签 '放逐/翻面' 与标版共用——同一角色只会拥有一版放逐)。
//
// 已知简化:对已背面目标再次放逐不实现官方 toggle(翻面两次=翻回正面),
// 与全引擎翻面模型一致(flipFaceDown 只追加标签,回合管理的 flipFaceUpAll
// 一次清全部 /翻面 标签,双翻无法对消)。
import { createFangzhuSkill, type FangzhuOptions } from './放逐';
import type { SkillModule } from '../types';

const OPTIONS: FangzhuOptions = {
  name: '界放逐',
  description: '受到伤害后,令一名其他角色翻面,并摸 X 张牌(X=已损失体力)',
  confirmRt: '界放逐/confirm',
  targetRt: '界放逐/target',
  confirmTitle: (lostHealth) => `是否发动界放逐?(令一名其他角色翻面并摸 ${lostHealth} 张牌)`,
  chooseTitle: '界放逐:选择一名其他角色(翻面并摸牌)',
  drawFirst: false,
  mountLabel: '界放逐',
  mountTitle: '是否发动界放逐?',
};

export const { createSkill, onInit, onMount } = createFangzhuSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
