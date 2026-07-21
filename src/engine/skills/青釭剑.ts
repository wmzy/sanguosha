// 青釭剑(武器,范围2):杀无视目标防具。
//
// 实现:临时卸载目标的防具技能实例(移除技能),杀结算后恢复(添加技能)。
// 不用标签——更干净的抽象:装备不需要知道青釭剑的行为,防具技能也不需要检查标签。
//
// 防具技能 id 通过目标装备栏防具动态查找:目标 equipment['防具'] → cardMap → card.name 即防具技能 id,
// 无需硬编码防具列表。
//
// 时机:
//   - 指定目标(杀 execute 内,造成伤害 之前):检测目标防具,移除技能
//   - 造成伤害(杀 execute 内):正常结算(防具 hook 已不在)
//   - 杀结算完毕后(造成伤害 after hook 恢复)
//
// 注意:移除技能 只卸载 hook 实例,不触发 卸下(装备仍在装备区)。
// 白银狮子的"失去装备回血"监听 卸下 atom,不会被 移除技能 触发——正确。
import type { AtomAfterContext, Skill, GameState } from '../types';

import { registerAfterHook, unloadSkillInstance, instantiateSkill } from '../skill';

/**
 * state-bound:记录当前被青釭剑临时卸载的防具,供 造成伤害 after hook 恢复。
 * key = 来源玩家(青釭剑使用者)座次下标,确保多玩家同时装备青釭剑时互不干扰。
 * WeakMap 外挂在 GameState 上,随 state 自动隔离/GC,无模块级泄漏。
 */
const tempUnloadByState = new WeakMap<GameState, Map<number, Array<{ target: number; skillId: string }>>>();

function getTempUnloadMap(state: GameState): Map<number, Array<{ target: number; skillId: string }>> {
  let m = tempUnloadByState.get(state);
  if (!m) {
    m = new Map();
    tempUnloadByState.set(state, m);
  }
  return m;
}

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '青釭剑', description: '武器:杀无视目标防具', isLocked: true };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // 指定目标 after hook:杀指定目标后,临时卸载目标的防具技能
  registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx: AtomAfterContext) => {
    if ((ctx.atom as { source?: number }).source !== ownerId) return;

    const me = ctx.state.players[ownerId];
    if (!me) return;
    const weaponId = me.equipment['武器'];
    if (!weaponId) return;
    const weaponCard = ctx.state.cardMap[weaponId];
    if (weaponCard?.name !== '青釭剑') return;

    const target = (ctx.atom as { target: number }).target;
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer) return;

    // 检查目标装备了什么防具,临时卸载对应技能
    const armorId = targetPlayer.equipment?.['防具'];
    if (!armorId) return;
    const armorCard = ctx.state.cardMap[armorId];
    if (!armorCard) return;

    // 防具牌 card.name 即防具技能 id;检查目标已加载该技能,临时卸载
    const unloaded: Array<{ target: number; skillId: string }> = [];
    const armorSkillId = armorCard.name;
    if (armorSkillId && targetPlayer.skills.includes(armorSkillId)) {
      unloaded.push({ target, skillId: armorSkillId });
      unloadSkillInstance(ctx.state, armorSkillId, target);
    }
    if (unloaded.length > 0) {
      getTempUnloadMap(ctx.state).set(ownerId, unloaded);
    }
  });

  // 造成伤害 after hook:杀结算完毕后,恢复被临时卸载的防具技能
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    if ((ctx.atom as { source?: number }).source !== ownerId) return;
    const unloaded = getTempUnloadMap(ctx.state).get(ownerId);
    if (!unloaded || unloaded.length === 0) return;
    for (const { target, skillId } of unloaded) {
      await instantiateSkill(ctx.state, skillId, target);
    }
    getTempUnloadMap(ctx.state).delete(ownerId);
  });

  return () => {};
}
