// 方天画戟(武器,攻击范围 4):
//   当你使用【杀】时,若此杀是你最后 1 张手牌,你可以额外指定至多 2 个目标(最多 3 名)。
//
//   实现:注册「杀目标数提供者」(slash-target.ts,与 slash-quota 同构的查询型 provider)。
//   杀的 canUseSlash 调 slashTargetMax 校验目标数上限——默认 1;方天画戟提供者在
//   「装备方天画戟 + 最后一张手牌(手牌仅此一张)」时返回 3,放宽上限。
//   该 provider 随技能实例生命周期注册/卸载:装备被换下/弃置时随实例销毁。
//   动态校核装备仍在(陷阱#8):校验时实时读装备槽,允许同帧内换下后不再触发。
//   借刀杀人出的杀也走 canUseSlash 路径(forced 模式 + 借刀 respond.validate),故被借刀者
//   满足条件时同样允许多目标。
import type { Skill, GameState } from '../types';
import { registerSlashTargetProvider } from '../rules/slash-target';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '方天画戟', description: '武器:最后一张手牌为杀时可指定最多3个目标', isLocked: true };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // 注册杀目标数提供者:装备方天画戟 + 最后一张手牌时允许最多 3 目标。
  // 返回取消注册函数,由 setSkillInstanceUnload 在卸载技能实例(换装/弃装)时自动清理。
  return registerSlashTargetProvider(state, ownerId, (st, _p, _cardId) => {
    // 动态校核装备仍在(陷阱#8):装备可能同帧内被换下,按当前装备槽实时判定
    const weaponId = st.players[ownerId]?.equipment['武器'];
    if (!weaponId || st.cardMap[weaponId]?.name !== '方天画戟') return 0;
    // 最后一张手牌:手牌仅此一张(这张杀即唯一手牌)。
    // 武圣转化杀同理——来源于最后一张手牌,亦满足「最后一张手牌出的杀」。
    // 丈八蛇矛转化用 2 张手牌(hand.length≥2),不满足,正确排除。
    const hand = st.players[ownerId]?.hand;
    if (hand?.length !== 1) return 0;
    return 3;
  });
}
