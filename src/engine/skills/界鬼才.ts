// 界鬼才(界司马懿·被动触发):在任意角色的判定牌生效前,你可以打出一张手牌或装备牌代替之。
//
// 界限突破(相对标鬼才 src/engine/skills/鬼才.ts):机制(registerJudgeModifier /
// respond action / replaceJudgeCard 改判)与标版一致,复用其 createGuicaiSkill 工厂,
// 仅注入差异参数 includeEquipment —— 装备区牌亦可作替换牌:
//   1. 询问 prompt 显式下发 candidates(手牌+装备区,仿界天香):投影层
//      resolveCardFilterCandidates 只遍历 player.hand,不显式投影则装备牌在客户端不可达;
//   2. 装备牌替换前先卸载其自带技能(移除技能),再从装备区卸下到手牌(卸下),
//      然后走与标版相同的 replaceJudgeCard 交换判定牌流程
//      (与 装备通用 换装流程的 移除技能 → 卸下 序列一致)。
//
// 键名与标版的关系:localVars 键沿用 '鬼才/replaceCard' 前缀(工厂缺省值);
//   requestType 用 '界鬼才/replace'(标/界询问键隔离)。
import { createGuicaiSkill, type GuicaiOptions } from './鬼才';

const OPTIONS: GuicaiOptions = {
  name: '界鬼才',
  description: '判定牌生效前,你可以打出一张手牌或装备牌代替之',
  replaceRequestType: '界鬼才/replace',
  promptName: '界鬼才',
  cardNoun: '手牌或装备牌',
  includeEquipment: true,
};

export const { createSkill, onInit, onMount } = createGuicaiSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
