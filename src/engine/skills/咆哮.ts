// 咆哮(张飞·锁定技):出牌阶段,你使用【杀】无次数限制。
//
// 实现机制(与诸葛连弩完全一致,出杀上限模型见 slash-quota.ts):
//   onInit 注册一个出杀上限提供者,返回 Infinity → slashMax 返回 ∞ → 可无限出杀。
//   提供者随技能实例生命周期注册/卸载:武将技能开局即实例化(注册),整局常驻。
//
// 与诸葛连弩的区别:诸葛连弩是装备技能(装备/换装/弃装时实例化/销毁),
//   咆哮是武将锁定技(开局即生效,整局常驻)。机制本身完全相同。
import type { Skill, GameState } from '../types';
import { registerSlashMaxProvider } from '../slash-quota';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '咆哮', description: '锁定技:出牌阶段使用【杀】无次数限制', isLocked: true };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  // 注册出杀上限提供者:返回 Infinity → slashMax = ∞ → 可无限出杀。
  // 返回取消注册函数,由 setSkillInstanceUnload 统一管理。
  return registerSlashMaxProvider(state, ownerId, () => Infinity);
}
