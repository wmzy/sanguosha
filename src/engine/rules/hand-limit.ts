// 手牌上限计算——覆盖型提供者模式(镜像 slash-quota.ts 的 registerSlashQuotaProvider)。
//
// 默认手牌上限 = 当前体力值 + 本回合加成(turn.vars['手牌上限/bonus:<player>'])。
// 技能(如界英姿「你的手牌上限为你的体力上限」)可注册"覆盖型提供者",
// 返回一个绝对值,完全替代默认公式——只要技能实例在场就生效(永久,非回合内临时)。
//
// 多个覆盖提供者并存时取最大值(最宽松);无任何覆盖提供者则走默认公式。
//
// 注册表为 state-bound(WeakMap 外挂在 GameState 上),随 state 自动隔离与 GC,
// 无模块级全局状态泄漏(与 skill.ts / slash-quota.ts 的 registries 同构)。

import type { GameState } from '../types';
import { getHealthValue } from '../types';
import { createProviderRegistry } from './provider-registry';
import { getHandLimitBonus } from './vars-keys';

/**
 * 手牌上限覆盖提供者:返回该玩家手牌上限的绝对值(undefined = 不覆盖)。
 * 例:界英姿注册 () => state.players[player]?.maxHealth。
 */
export type HandLimitProvider = (state: GameState, player: number) => number | undefined;

// ─── state-bound 注册表(WeakMap 外挂,随 state 自动隔离/GC,样板见 rules/provider-registry.ts) ───

const handLimitRegistry = createProviderRegistry<HandLimitProvider>();

/**
 * 注册一个手牌上限覆盖提供者(技能 onInit 时调用,与 registerAction/registerSlashQuotaProvider 同构)。
 * 返回取消注册函数——技能 onInit 应将其并入返回的 unload,由 setSkillInstanceUnload
 * 统一管理,卸载技能实例时自动清理。
 */
export function registerHandLimitProvider(
  state: GameState,
  ownerId: number,
  provider: HandLimitProvider,
): () => void {
  return handLimitRegistry.register(state, ownerId, provider);
}

/**
 * 玩家手牌上限。
 * - 若注册了覆盖提供者:取所有覆盖值中的最大值(最宽松),完全替代默认公式。
 * - 否则:当前体力值 + 本回合加成(turn.vars['手牌上限/bonus:<player>'])。
 *
 * 弃牌阶段(回合管理.ts)与弃牌超时(请求回应.ts)统一调用本函数,
 * 确保界英姿等"手牌上限=体力上限"的锁定技在所有读取点一致生效。
 */
export function handLimit(state: GameState, player: number): number {
  let maxOverride = -Infinity;
  handLimitRegistry.forEachOf(state, player, (fn) => {
    const v = fn(state, player);
    if (typeof v === 'number' && v > maxOverride) maxOverride = v;
  });
  if (maxOverride !== -Infinity) return maxOverride;
  const bonus = getHandLimitBonus(state.turn.vars, player) ?? 0;
  // 手牌上限基于「体力值」（封底为 0），非原始「体力」（可负）。
  return getHealthValue(state.players[player]) + bonus;
}
