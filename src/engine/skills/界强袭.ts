// 界强袭(界典韦·主动技,OL 界限突破官方逐字):
//   出牌阶段限两次,你可以受到1点伤害或弃置一张武器牌,
//   对一名本回合内未以此法指定过的其他角色造成1点伤害。
//
// 界限突破(相对标强袭 src/engine/skills/强袭.ts):
//   1. 标强袭:"自减1点体力"(失去体力,非伤害——不触发防具/反馈)。
//   2. 界强袭:"受到1点伤害"(真实伤害事件,触发反馈/奸雄/八卦阵等)。
//   3. 界强袭:每名其他角色本回合仅能被此法指定一次("本回合内未以此法指定过")。
//
// 实现/交互复用标版强袭导出的 createQiangxiSkill 工厂,仅注入差异:
//   - 键名按技能 id '界强袭' 隔离(界强袭/usedThisTurn、界强袭/targets/usedThisTurn)。
//   - 代价 token 'damage'(受到1点伤害,runDamageFlow 自伤——触发反馈/奸雄等伤害来源技能)。
//   - 无距离限制:与标版强袭一致,官方未对此法提距离限制。
//
// 命名:文件名/loader key/character skill name 均为 '界强袭'(避开标强袭冲突);
//   内部 Skill.name = '强袭'(OL 官方技能名,玩家可见)。
import { runDamageFlow } from '../flows/damage';
import { createQiangxiSkill, type QiangxiOptions } from './强袭';
import type { SkillModule } from '../types';

const OPTIONS: QiangxiOptions = {
  skillId: '界强袭',
  displayName: '强袭',
  description:
    '出牌阶段限两次:受到1点伤害或弃一张武器牌,对一名本回合未以此法指定过的其他角色造成1点伤害',
  hpCostToken: 'damage',
  hpCostVariantLabel: '受到1点伤害',
  targetTitle: '强袭:选择一名本回合未以此法指定过的角色(受到1点伤害或弃武器,对其造成1点伤害)',
  payHpCost: async (st, from) => {
    await runDamageFlow(st, from, from, 1);
  },
  phaseError: '只能在出牌阶段发动',
  blockingError: '当前有未完成的询问',
  deadError: '玩家不存在或已死亡',
  costParamError: 'cost 必须为 damage 或 discard',
};

export const { createSkill, onInit, onMount } = createQiangxiSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
