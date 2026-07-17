// 手牌上限计算——覆盖型提供者模式(镜像 slash-quota.ts 的 registerSlashMaxProvider)。
//
// 默认手牌上限 = 当前体力值 + 本回合加成(turn.vars['手牌上限/bonus:<player>'])。
// 技能(如界英姿「你的手牌上限为你的体力上限」)可注册"覆盖型提供者",
// 返回一个绝对值,完全替代默认公式——只要技能实例在场就生效(永久,非回合内临时)。
//
// 多个覆盖提供者并存时取最大值(最宽松);无任何覆盖提供者则走默认公式。
//
// 注册表为 state-bound(WeakMap 外挂在 GameState 上),随 state 自动隔离与 GC,
// 无模块级全局状态泄漏(与 skill.ts / slash-quota.ts 的 registries 同构)。

import type { GameState } from './types';

/**
 * 手牌上限覆盖提供者:返回该玩家手牌上限的绝对值(undefined = 不覆盖)。
 * 例:界英姿注册 () => state.players[player]?.maxHealth。
 */
export type HandLimitProvider = (state: GameState, player: number) => number | undefined;

// ─── state-bound 注册表(WeakMap 外挂,随 state 自动隔离/GC) ───

interface HandLimitRegistry {
  /** player 索引 → 该玩家当前注册的覆盖提供者集合 */
  providers: Map<number, Set<HandLimitProvider>>;
}

const handLimitRegistries = new WeakMap<GameState, HandLimitRegistry>();

function getHandLimitRegistry(state: GameState): HandLimitRegistry {
  let reg = handLimitRegistries.get(state);
  if (!reg) {
    reg = { providers: new Map() };
    handLimitRegistries.set(state, reg);
  }
  return reg;
}

/**
 * 注册一个手牌上限覆盖提供者(技能 onInit 时调用,与 registerAction/registerSlashMaxProvider 同构)。
 * 返回取消注册函数——技能 onInit 应将其并入返回的 unload,由 setSkillInstanceUnload
 * 统一管理,卸载技能实例时自动清理。
 */
export function registerHandLimitProvider(
  state: GameState,
  ownerId: number,
  provider: HandLimitProvider,
): () => void {
  const reg = getHandLimitRegistry(state);
  let set = reg.providers.get(ownerId);
  if (!set) {
    set = new Set();
    reg.providers.set(ownerId, set);
  }
  set.add(provider);
  return () => {
    const s = reg.providers.get(ownerId);
    if (s) {
      s.delete(provider);
      if (s.size === 0) reg.providers.delete(ownerId);
    }
  };
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
  const set = getHandLimitRegistry(state).providers.get(player);
  if (set && set.size > 0) {
    let maxOverride = -Infinity;
    for (const fn of set) {
      const v = fn(state, player);
      if (typeof v === 'number' && v > maxOverride) maxOverride = v;
    }
    if (maxOverride !== -Infinity) return maxOverride;
  }
  const bonus = (state.turn.vars[`手牌上限/bonus:${player}`] as number | undefined) ?? 0;
  const p = state.players[player];
  return (p?.health ?? 0) + bonus;
}
