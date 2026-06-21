// 诸葛连弩(武器,攻击范围 1):出牌阶段使用【杀】无次数限制。
//
// 实现机制(出杀上限模型见 slash-quota.ts):
//   onInit 注册一个出杀上限提供者,返回 Infinity → slashMax 返回 ∞ → 可无限出杀。
//   提供者随技能实例生命周期注册/卸载:装备时实例化(注册),换装/弃装时卸载(取消注册)。
//
// 与旧 杀/quota 方案的关键区别:
//   上限来源(提供者查询)与已用次数(turn.vars['杀/usedCount'])分离。
//   卸载连弩只取消提供者(上限回到 1),usedCount 保留
//   → "装前出过杀,卸载后不能再用"自然成立。
//   无需 before hook 兜底,无需 onInstantiate/onDestroy 写状态——提供者存在即贡献。
import type { Skill } from '../types';
import { registerSlashMaxProvider } from '../slash-quota';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '诸葛连弩', description: '武器:出牌阶段使用【杀】无次数限制' };
}

export function onInit(_skill: Skill, ownerId: number): (() => void) | void {
  // 注册出杀上限提供者:返回 Infinity → slashMax = ∞ → 可无限出杀。
  // unloader 并入返回值,由 setSkillInstanceUnload 统一管理,卸载技能实例时自动取消注册。
  return registerSlashMaxProvider(ownerId, () => Infinity);
}
