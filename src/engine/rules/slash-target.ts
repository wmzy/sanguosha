// 杀目标数上限计算——查询型提供者模式(与 slash-quota.ts / distance.ts 同构)。
//
// 背景:三国杀默认一张【杀】只能指定 1 名目标;方天画戟(最后一张手牌)/天义(拼点赢)/
// 疠火(火杀)等可放宽目标上限。此前引擎的做法是杀的 targetFilter.max 写死 3 + canUseSlash
// 不校验数量,导致任何人的杀都能多目标(方天画戟条件形同虚设)。
//
// 本模块建立统一的「杀目标数上限」查询机制,作为后端权威:
//   - 技能 onInit 注册提供者(随技能实例生命周期注册/卸载,无泄漏)
//   - canUseSlash / 借刀杀人 respond.validate 调 slashTargetMax 校验选定目标数
//   - 各提供者返回「该来源允许的最大目标数」,取 max(最宽松生效);无提供者时默认 1
//
// 提供者签名携带 cardId,支持 per-card 决策(疠火判火杀属性、方天画戟判最后一张手牌)。
// 注册表为 state-bound(WeakMap 外挂在 GameState 上),随 state 自动隔离与 GC。

import type { GameState } from '../types';

/**
 * 杀目标数提供者:返回该来源允许的【杀】最大目标数。
 * 返回 ≤1 表示「无额外贡献」(不放宽默认的 1);返回 >1 表示「放宽到该值」。
 * 携带 cardId 让提供者能基于卡牌属性(火杀/最后一张手牌)做 per-card 决策。
 */
export type SlashTargetProvider = (
  state: GameState,
  player: number,
  cardId: string | undefined,
) => number;

interface SlashTargetRegistry {
  /** player 索引 → 该玩家当前注册的目标数提供者集合 */
  targetProviders: Map<number, Set<SlashTargetProvider>>;
}

const slashTargetRegistries = new WeakMap<GameState, SlashTargetRegistry>();

function getSlashTargetRegistry(state: GameState): SlashTargetRegistry {
  let reg = slashTargetRegistries.get(state);
  if (!reg) {
    reg = { targetProviders: new Map() };
    slashTargetRegistries.set(state, reg);
  }
  return reg;
}

/**
 * 注册一个杀目标数提供者(技能 onInit 时调用,与 registerAction 同构)。
 * 返回取消注册函数——应并入 onInit 返回的 unload,由 setSkillInstanceUnload
 * 在卸载技能实例时自动清理(装备被换下/弃置时随实例销毁)。
 */
export function registerSlashTargetProvider(
  state: GameState,
  ownerId: number,
  provider: SlashTargetProvider,
): () => void {
  const map = getSlashTargetRegistry(state).targetProviders;
  let set = map.get(ownerId);
  if (!set) {
    set = new Set();
    map.set(ownerId, set);
  }
  set.add(provider);
  return () => {
    const s = map.get(ownerId);
    if (s) {
      s.delete(provider);
      if (s.size === 0) map.delete(ownerId);
    }
  };
}

/**
 * 该玩家使用指定【杀】时可指定的最大目标数。
 * 默认 1;各提供者取最大值(最宽松生效)。无提供者或均无贡献时返回 1。
 *
 * cardId 可选:传入时提供者可做 per-card 决策(疠火判火杀);缺省时仅问无卡牌上下文的提供者。
 */
export function slashTargetMax(
  state: GameState,
  player: number,
  cardId?: string,
): number {
  const set = getSlashTargetRegistry(state).targetProviders.get(player);
  if (!set || set.size === 0) return 1;
  let max = 1;
  for (const provider of set) {
    const v = provider(state, player, cardId);
    if (v > max) max = v;
  }
  return max;
}
