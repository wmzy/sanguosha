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
//
// 注册表为 state-bound(WeakMap 外挂在 GameState 上),随 state 自动隔离与 GC,
// 无模块级全局状态泄漏(与 skill.ts 的 registries 同构)。

import type { GameState } from './types';

/** 本回合已出杀次数的 vars key */
export const SLASH_USED_VAR = '杀/usedCount';

/**
 * 出杀上限提供者:返回该来源贡献的上限加成。
 * 返回 Infinity 表示"无限出杀"(如诸葛连弩);返回 0 或正数表示加成值。
 */
export type SlashMaxProvider = (state: GameState, player: number) => number;

/**
 * 出杀阻断器:返回 true 表示该玩家本回合被禁止出杀(无论剩余次数)。
 * 用于"拼点输了本回合不能用杀"类效果(天义)。与上限提供者对称:
 * 提供者放宽上限,阻断器直接禁用。
 */
export type SlashBlocker = (state: GameState, player: number) => boolean;

/**
 * 出杀豁免器:返回 true 表示该张【杀】不占用出杀次数(仍受阻断器约束)。
 * 携带 cardId 让 provider 能基于卡牌属性(如花色/点数/转化来源)做 per-card 决策。
 * 用于"同花色杀无次数限制"(界弓骑)等效果。与上限提供者互补:
 * 上限提供者放宽"还能出几张",豁免器直接令"这张不计"。
 */
export type SlashExemptor = (
  state: GameState,
  player: number,
  cardId: string | undefined,
) => boolean;

// ─── state-bound 注册表(WeakMap 外挂,随 state 自动隔离/GC) ───

interface SlashRegistry {
  /** player 索引 → 该玩家当前注册的上限提供者集合 */
  providers: Map<number, Set<SlashMaxProvider>>;
  /** player 索引 → 该玩家当前注册的阻断器集合 */
  blockers: Map<number, Set<SlashBlocker>>;
  /** player 索引 → 该玩家当前注册的豁免器集合 */
  exemptors: Map<number, Set<SlashExemptor>>;
}

const slashRegistries = new WeakMap<GameState, SlashRegistry>();

function getSlashRegistry(state: GameState): SlashRegistry {
  let reg = slashRegistries.get(state);
  if (!reg) {
    reg = { providers: new Map(), blockers: new Map(), exemptors: new Map() };
    slashRegistries.set(state, reg);
  }
  return reg;
}

/**
 * 注册一个出杀上限提供者(技能 onInit 时调用,与 registerAction 同构)。
 * 返回取消注册函数——技能 onInit 应将其并入返回的 unload,由 setSkillInstanceUnload
 * 统一管理,卸载技能实例时自动清理。
 */
export function registerSlashMaxProvider(
  state: GameState,
  ownerId: number,
  provider: SlashMaxProvider,
): () => void {
  const reg = getSlashRegistry(state);
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
 * 当前玩家本回合的出杀次数上限。
 * 基础 1 + 各提供者贡献之和;任一提供者返回 Infinity → ∞。
 */
export function slashMax(state: GameState, player: number): number {
  let max = 1; // 基础上限
  const set = getSlashRegistry(state).providers.get(player);
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
 * 必须并入 onInit 返回的 unload,由 setSkillInstanceUnload 在卸载技能实例时自动清理。
 */
export function registerSlashBlocker(
  state: GameState,
  ownerId: number,
  blocker: SlashBlocker,
): () => void {
  const reg = getSlashRegistry(state);
  let set = reg.blockers.get(ownerId);
  if (!set) {
    set = new Set();
    reg.blockers.set(ownerId, set);
  }
  set.add(blocker);
  return () => {
    const s = reg.blockers.get(ownerId);
    if (s) {
      s.delete(blocker);
      if (s.size === 0) reg.blockers.delete(ownerId);
    }
  };
}

/** 该玩家本回合是否被阻断出杀(任一阻断器返回 true 即阻断) */
export function isSlashBlocked(state: GameState, player: number): boolean {
  const set = getSlashRegistry(state).blockers.get(player);
  if (!set) return false;
  for (const fn of set) {
    if (fn(state, player)) return true;
  }
  return false;
}

/**
 * 注册一个出杀豁免器(技能 onInit 时调用,与 registerSlashBlocker 同构)。
 * 返回的取消注册函数应并入 onInit 返回的 unload。
 */
export function registerSlashExemptor(
  state: GameState,
  ownerId: number,
  exemptor: SlashExemptor,
): () => void {
  const reg = getSlashRegistry(state);
  let set = reg.exemptors.get(ownerId);
  if (!set) {
    set = new Set();
    reg.exemptors.set(ownerId, set);
  }
  set.add(exemptor);
  return () => {
    const s = reg.exemptors.get(ownerId);
    if (s) {
      s.delete(exemptor);
      if (s.size === 0) reg.exemptors.delete(ownerId);
    }
  };
}

/** 该玩家当前使用的这张【杀】是否豁免出杀次数(任一豁免器返回 true 即豁免)。
 *  cardId 缺省时只问"无卡牌上下文"的豁免器(目前无此用例,恒返回 false)。 */
export function isSlashExempted(
  state: GameState,
  player: number,
  cardId: string | undefined,
): boolean {
  if (cardId === undefined) return false;
  const set = getSlashRegistry(state).exemptors.get(player);
  if (!set) return false;
  for (const fn of set) {
    if (fn(state, player, cardId)) return true;
  }
  return false;
}

/** 当前玩家是否还能出杀(未被阻断 且 已用次数 < 上限)。
 *  cardId 可选:若提供且该卡被任一豁免器命中,则绕过次数上限检查。 */
export function canSlash(
  state: GameState,
  player: number,
  cardId?: string,
): boolean {
  if (isSlashBlocked(state, player)) return false;
  if (cardId !== undefined && isSlashExempted(state, player, cardId)) return true;
  return slashUsed(state) < slashMax(state, player);
}

/** 记录一次出杀(已用次数 +1)。在杀 use 的 execute 末尾调用 */
export function incSlashUsed(state: GameState): void {
  state.turn.vars[SLASH_USED_VAR] = slashUsed(state) + 1;
}
