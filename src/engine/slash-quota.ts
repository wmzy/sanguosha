// src/engine/slash-quota.ts
// 出杀次数上限计算——查询型提供者模式(与 registerAction/registerBeforeHook 同构)。
//
// 技能不预写状态,而是在 onInit 时注册一个"出杀上限提供者",声明"我为 owner 贡献多少上限"。
// slashMax 被调用时动态收集所有提供者的贡献,叠加得出当前上限。
//
// 优势(对比状态预写):
//   - 无状态副作用:提供者随技能实例注册/卸载(走现有 unload 清理链),无遗漏泄漏
//   - ∞ 与数值走同一机制(提供者返回 Infinity 或具体数值)
//   - 多技能天然叠加(连弩 + 未来武将各注册一个提供者,自动累加)
//
// 上限 = 基础 1 + Σ(各提供者贡献);任一提供者返回 Infinity → 总上限 ∞
// 已用次数 = turn.vars['杀/usedCount'](出杀 +1,回合结束随 turn.vars 清空)

import type { GameState } from './types';

/** 本回合已出杀次数的 vars key */
export const SLASH_USED_VAR = '杀/usedCount';

/**
 * 出杀上限提供者:返回该来源贡献的上限加成。
 * 返回 Infinity 表示"无限出杀"(如诸葛连弩);返回 0 或正数表示加成值。
 */
export type SlashMaxProvider = (state: GameState, player: number) => number;

/** player 索引 → 该玩家当前注册的上限提供者集合 */
const providersByPlayer = new Map<number, Set<SlashMaxProvider>>();

/**
 * 出杀阻断器:返回 true 表示该玩家本回合被禁止出杀(无论剩余次数)。
 * 用于"拼点输了本回合不能用杀"类效果(天义)。与上限提供者对称:
 * 提供者放宽上限,阻断器直接禁用。阻断器随技能实例注册/卸载(走 unload 清理链)。
 */
export type SlashBlocker = (state: GameState, player: number) => boolean;

/** player 索引 → 该玩家当前注册的阻断器集合 */
const blockersByPlayer = new Map<number, Set<SlashBlocker>>();

/**
 * 注册一个出杀上限提供者(技能 onInit 时调用,与 registerAction 同构)。
 * 返回取消注册函数——技能 onInit 应将其并入返回的 unload,由 setSkillInstanceUnload
 * 统一管理,卸载技能实例时自动清理。
 */
export function registerSlashMaxProvider(ownerId: number, provider: SlashMaxProvider): () => void {
  let set = providersByPlayer.get(ownerId);
  if (!set) {
    set = new Set();
    providersByPlayer.set(ownerId, set);
  }
  set.add(provider);
  return () => {
    const s = providersByPlayer.get(ownerId);
    if (s) {
      s.delete(provider);
      if (s.size === 0) providersByPlayer.delete(ownerId);
    }
  };
}

/**
 * 当前玩家本回合的出杀次数上限。
 * 基础 1 + 各提供者贡献之和;任一提供者返回 Infinity → ∞。
 */
export function slashMax(state: GameState, player: number): number {
  let max = 1; // 基础上限
  const set = providersByPlayer.get(player);
  if (set) {
    for (const fn of set) {
      const bonus = fn(state, player);
      if (bonus === Infinity) return Infinity;
      if (bonus > 0) max += bonus;
    }
  }
  return max;
}

/** 当前玩家本回合已出杀次数(默认 0) */
export function slashUsed(state: GameState): number {
  const used = state.turn.vars[SLASH_USED_VAR] as number | undefined;
  return typeof used === 'number' ? used : 0;
}

/**
 * 注册一个出杀阻断器(技能 onInit 时调用)。返回取消注册函数——
 * 阻断器是模块级集合(非 state-bound 注册表),必须并入 onInit 返回的 unload,
 * 由 setSkillInstanceUnload 在卸载技能实例时自动清理。
 */
export function registerSlashBlocker(ownerId: number, blocker: SlashBlocker): () => void {
  let set = blockersByPlayer.get(ownerId);
  if (!set) {
    set = new Set();
    blockersByPlayer.set(ownerId, set);
  }
  set.add(blocker);
  return () => {
    const s = blockersByPlayer.get(ownerId);
    if (s) {
      s.delete(blocker);
      if (s.size === 0) blockersByPlayer.delete(ownerId);
    }
  };
}

/** 该玩家本回合是否被阻断出杀(任一阻断器返回 true 即阻断) */
export function isSlashBlocked(state: GameState, player: number): boolean {
  const set = blockersByPlayer.get(player);
  if (!set) return false;
  for (const fn of set) {
    if (fn(state, player)) return true;
  }
  return false;
}

/** 当前玩家是否还能出杀(未被阻断 且 已用次数 < 上限) */
export function canSlash(state: GameState, player: number): boolean {
  if (isSlashBlocked(state, player)) return false;
  return slashUsed(state) < slashMax(state, player);
}

/** 记录一次出杀(已用次数 +1)。在杀 use 的 execute 末尾调用 */
export function incSlashUsed(state: GameState): void {
  state.turn.vars[SLASH_USED_VAR] = slashUsed(state) + 1;
}

/** 测试用:清空所有上限提供者与阻断器(由 create-engine.resetForTest 调用) */
export function clearSlashMaxProviders(): void {
  providersByPlayer.clear();
  blockersByPlayer.clear();
}
