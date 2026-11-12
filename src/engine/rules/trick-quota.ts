// 普通锦囊牌使用阻断器(类比 slash-quota.ts 的 SlashBlocker)。
//
// 技能(如界简雍·巧说"若你没赢,…你不能使用锦囊牌直到回合结束")注册阻断器,
// 使被阻断玩家本回合不能使用普通锦囊牌。validateUseCard 在校验普通锦囊牌的 use 时
// 查询此注册表:若被阻断则拒绝(返回错误信息)。
//
// 与 slash-quota 同构:注册表为 state-bound(WeakMap 外挂 GameState),
// 随 state 自动隔离与 GC,无模块级全局状态泄漏。阻断器是查询型谓词(读取 state),
// 不预写状态——技能只需在 onInit 注册一次,谓词内动态读 turn.vars 判定当前是否生效。

import type { GameState } from '../types';
import { createProviderRegistry } from './provider-registry';

/**
 * 普通锦囊牌阻断器:返回 true 表示该玩家本回合被禁止使用普通锦囊牌。
 * 用于"拼点输了本回合不能用锦囊牌"类效果(巧说)。与 SlashBlocker 对称。
 */
export type TrickBlocker = (state: GameState, player: number) => boolean;

// ─── state-bound 注册表(WeakMap 外挂,随 state 自动隔离/GC,样板见 rules/provider-registry.ts) ───

const trickBlockerRegistry = createProviderRegistry<TrickBlocker>();

/**
 * 注册一个普通锦囊牌阻断器(技能 onInit 时调用,与 registerSlashBlocker 同构)。
 * 返回取消注册函数——必须并入 onInit 返回的 unload,在卸载技能实例时自动清理。
 * ownerId 仅用于注册表生命周期管理;查询(isTrickBlocked)遍历所有阻断器。
 */
export function registerTrickBlocker(
  state: GameState,
  ownerId: number,
  blocker: TrickBlocker,
): () => void {
  return trickBlockerRegistry.register(state, ownerId, blocker);
}

/** 该玩家本回合是否被阻断使用普通锦囊牌(任一阻断器返回 true 即阻断)。 */
export function isTrickBlocked(state: GameState, player: number): boolean {
  return trickBlockerRegistry.someAll(state, (blocker) => blocker(state, player));
}
