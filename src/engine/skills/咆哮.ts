// 咆哮(张飞·锁定技):出牌阶段,你使用【杀】无次数限制。
//
// 实现机制(与诸葛连弩完全一致,出杀上限模型见 slash-quota.ts):
//   registerAlwaysUnlimitedWithProjection 一体注册「无限出杀提供者 + view 投影」:
//   提供者返回 true → slashMax = ∞ → 可无限出杀;拥有者每个出牌阶段开始时把
//   '杀/unlimited/咆哮' 投影到 view.turnUsage(回合结束自动清空),前端/MCP 客户端的
//   viewSlashMax 据此推断无限出杀(缺失则首次出杀后【杀】从 availableActions 消失)。
//   提供者随技能实例生命周期注册/卸载:武将技能开局即实例化(注册),整局常驻。
//
// 与诸葛连弩的区别:诸葛连弩是装备技能(装备/换装/弃装时实例化/销毁),
//   咆哮是武将锁定技(开局即生效,整局常驻)。机制本身完全相同。
import type { Skill, GameState } from '../types';
import { registerAlwaysUnlimitedWithProjection } from '../rules/slash-quota';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '咆哮', description: '锁定技:出牌阶段使用【杀】无次数限制', isLocked: true };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  return registerAlwaysUnlimitedWithProjection(state, skill.id, skill.ownerId);
}
