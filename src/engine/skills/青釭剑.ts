// 青釭剑(武器,范围2):杀无视目标防具。
//
// 实现:临时卸载目标的防具技能实例(移除技能),杀结算后恢复(添加技能)。
// 不用标签——更干净的抽象:装备不需要知道青釭剑的行为,防具技能也不需要检查标签。
//
// 时机:
//   - 指定目标(杀 execute 内,造成伤害 之前):检测目标防具,移除技能
//   - 造成伤害(杀 execute 内):正常结算(防具 hook 已不在)
//   - 杀结算完毕后(造成伤害 after hook 恢复)
//
// 注意:移除技能 只卸载 hook 实例,不触发 卸下(装备仍在装备区)。
// 白银狮子的"失去装备回血"监听 卸下 atom,不会被 移除技能 触发——正确。
import type { AtomBeforeContext, AtomAfterContext, Skill, GameState} from '../types';
import { applyAtom } from '../create-engine';
import { registerAfterHook, unloadSkillInstance, instantiateSkill, type SkillModule } from '../skill';

/** 已知防具技能 id 列表——青釭剑临时卸载时遍历检查 */
const ARMOR_SKILLS = ['仁王盾', '护甲', '藤甲', '白银狮子', '八卦阵'];

/**
 * 模块级:记录当前被青釭剑临时卸载的防具,供 造成伤害 after hook 恢复。
 * key = 来源玩家(青釭剑使用者)座次下标,确保多玩家同时装备青釭剑时互不干扰。
 * 这取代了旧的 state.localVars['青釭剑/临时卸载'] 跨 atom 通信。
 */
const tempUnloadMap = new Map<number, Array<{ target: number; skillId: string }>>();

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '青釭剑', description: '武器:杀无视目标防具' };
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
    if (!weaponCard || weaponCard.name !== '青釭剑') return;

    const target = (ctx.atom as { target: number }).target;
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer) return;

    // 检查目标装备了什么防具,临时卸载对应技能
    const armorId = targetPlayer.equipment?.['防具'];
    if (!armorId) return;
    const armorCard = ctx.state.cardMap[armorId];
    if (!armorCard) return;

    // 找到目标当前已加载的防具技能,临时卸载
    const unloaded: Array<{ target: number; skillId: string }> = [];
    for (const skillId of ARMOR_SKILLS) {
      if (targetPlayer.skills.includes(skillId)) {
        unloaded.push({ target, skillId });
        unloadSkillInstance(ctx.state, skillId, target);
      }
    }
    if (unloaded.length > 0) {
      tempUnloadMap.set(ownerId, unloaded);
    }
  });

  // 造成伤害 after hook:杀结算完毕后,恢复被临时卸载的防具技能
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    if ((ctx.atom as { source?: number }).source !== ownerId) return;
    const unloaded = tempUnloadMap.get(ownerId);
    if (!unloaded || unloaded.length === 0) return;
    for (const { target, skillId } of unloaded) {
      await instantiateSkill(ctx.state, skillId, target);
    }
    tempUnloadMap.delete(ownerId);
  });

  return () => {};
}

