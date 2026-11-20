// 青釭剑(武器,范围2):杀无视目标防具。
//
// 实现:临时卸载目标的防具技能实例(移除技能),杀结算后恢复(添加技能)。
// 不用标签——更干净的抽象:装备不需要知道青釭剑的行为,防具技能也不需要检查标签。
//
// 卸载/记录/双时机恢复的通用机制在 _tempArmorStrip.ts(与 界陷阵 共享);
// 防具技能 id 通过目标装备栏防具动态查找,无需硬编码防具列表。
//
// 时机:
//   - 指定目标(杀 execute 内,造成伤害 之前):仅对【杀】检测目标防具,移除技能
//   - 造成伤害(杀 execute 内):正常结算(防具 hook 已不在)
//   - 杀结算完毕后恢复:命中走 造成伤害后,被闪抵消走 被抵消(两者互斥,覆盖杀全部退出路径)
//
// 注意:移除技能 只卸载 hook 实例,不触发 卸下(装备仍在装备区)。
// 白银狮子的"失去装备回血"监听 卸下 atom,不会被 移除技能 触发——正确。
import type { Skill, GameState } from '../types';

import { registerAfterHook } from '../core/skill';
import { stripTargetArmor, registerArmorRestoreHooks } from './_tempArmorStrip';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '青釭剑', description: '武器:杀无视目标防具', isLocked: true };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // 指定目标 after hook:杀指定目标后,临时卸载目标的防具技能
  registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx) => {
    if ((ctx.atom).source !== ownerId) return;
    // 仅对【杀】生效(青釭剑规则:使用杀指定目标后);顺手牵羊/过河拆桥等
    // 目标牌不触发——否则防具被卸载后无法经 造成伤害后/被抵消 路径恢复而泄漏。
    const usedCardId = (ctx.atom).cardId;
    if (!usedCardId) return;
    const usedCard = ctx.state.cardMap[usedCardId];
    if (usedCard?.name !== '杀') return;

    const me = ctx.state.players[ownerId];
    if (!me) return;
    const weaponId = me.equipment['武器'];
    if (!weaponId) return;
    const weaponCard = ctx.state.cardMap[weaponId];
    if (weaponCard?.name !== '青釭剑') return;

    const target = (ctx.atom).target;
    // 目标的防具技能实例 → 临时卸载并记录(无防具/未加载则不动作)
    stripTargetArmor(ctx.state, ownerId, target);
  });

  // 杀结算完毕后恢复被临时卸载的防具技能。
  // 杀命中 → 造成伤害后;杀被闪抵消 → 被抵消。两条路径互斥,合起来覆盖杀的全部退出路径:
  // 原实现只挂 造成伤害后,dodge 时该 atom 不触发,防具永久泄漏(后续对目标的杀失去防具保护)。
  registerArmorRestoreHooks(state, ownerId, skill.id);

  return () => {};
}
