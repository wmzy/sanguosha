// 出杀次数上限计算——查询型提供者模式(与 registerAction/registerBeforeHook 同构)。
//
// 三层模型(对齐 docs/flow-redesign.md 模块 K / condition.md):
//   上限 = 额定(quota,覆盖型 max) + 额外(extra,叠加型 Σ);任一无限提供者命中 → ∞
//   已用 = 杀/quotaUsed(额定已用) + 杀/extraUsed(额外已用),消耗时优先扣额定
//
// 三类提供者:
//   · SlashQuotaProvider(额定):返回该来源设定的额定上限。slashQuotaMax = max(基础1, 各提供者)。
//     覆盖型——如某技能设额定=2。多个额定技能取最大值。
//   · SlashExtraProvider(额外):返回该来源贡献的额外次数。slashExtraMax = Σ(各提供者)。
//     叠加型——天义拼点赢 +1、诈降 +1、界鞬出累计 +N。
//   · SlashUnlimitedProvider(无限):返回 true 则该玩家本回合出杀无上限(诸葛连弩/咆哮)。
//
// 优势(对比状态预写):
//   - 无状态副作用:提供者随技能实例注册/卸载(走现有 unload 清理链),无遗漏泄漏
//   - ∞ 与数值分走不同机制(无限提供者布尔判定,额定/额外数值贡献)
//   - 多技能天然叠加(额定取大、额外求和)
//
// 已用次数 = turn.vars['杀/quotaUsed'] + turn.vars['杀/extraUsed']
//   (出杀时优先扣额定,额定满后扣额外;回合结束随 turn.vars 清空)
//
// 注册表为 state-bound(WeakMap 外挂在 GameState 上),随 state 自动隔离与 GC,
// 无模块级全局状态泄漏(与 skill.ts 的 registries 同构)。

import type { GameState } from './types';

/** 额定已用次数的 vars key */
const QUOTA_USED_VAR = '杀/quotaUsed';
/** 额外已用次数的 vars key */
const EXTRA_USED_VAR = '杀/extraUsed';
/**
 * view 侧"已出杀次数"投影 key(由「回合用量」atom 同步到 view.turnUsage)。
 * 历史上也是 state 计数 vars key;模块 K 拆分后 state 改用 杀/quotaUsed + 杀/extraUsed,
 * 本常量保留为 view 投影 key(viewSlashUsed / 前端 turnUsage 消费),值 = slashUsed() 合计。
 */
export const SLASH_USED_VAR = '杀/usedCount';

/**
 * 额定上限提供者:返回该来源设定的额定上限值。
 * 返回 0 或负数表示"无额定贡献"(不覆盖基础 1);返回正数表示"额定设为该值"(取最大)。
 */
export type SlashQuotaProvider = (state: GameState, player: number) => number;

/**
 * 额外次数提供者:返回该来源贡献的额外出杀次数(叠加)。
 * 返回 0 或正数;多提供者求和。
 */
export type SlashExtraProvider = (state: GameState, player: number) => number;

/**
 * 无限出杀提供者:返回 true 表示该玩家本回合出杀无次数上限(诸葛连弩/咆哮)。
 * 任一提供者返回 true → slashMax 返回 ∞。
 */
export type SlashUnlimitedProvider = (state: GameState, player: number) => boolean;

/**
 * 出杀阻断器:返回 true 表示该玩家本回合被禁止出杀(无论剩余次数)。
 * 用于"拼点输了本回合不能用杀"类效果(天义/界将驰)。与上限提供者对称:
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

/**
 * @deprecated 历史别名。旧语义为"叠加型加成"(base 1 + Σ);模块 K 拆分后统一改用
 * registerSlashQuotaProvider(额定/覆盖) / registerSlashExtraProvider(额外/叠加) /
 * registerSlashUnlimitedProvider(无限)。本别名现路由到额定提供者(max 语义)。
 * 旧调用方若依赖"叠加"语义,应迁移到 registerSlashExtraProvider。
 */
export type SlashMaxProvider = SlashQuotaProvider;

// ─── state-bound 注册表(WeakMap 外挂,随 state 自动隔离/GC) ───

interface SlashRegistry {
  /** player 索引 → 该玩家当前注册的额定上限提供者集合 */
  quotaProviders: Map<number, Set<SlashQuotaProvider>>;
  /** player 索引 → 该玩家当前注册的额外次数提供者集合 */
  extraProviders: Map<number, Set<SlashExtraProvider>>;
  /** player 索引 → 该玩家当前注册的无限出杀提供者集合 */
  unlimitedProviders: Map<number, Set<SlashUnlimitedProvider>>;
  /** player 索引 → 该玩家当前注册的阻断器集合 */
  blockers: Map<number, Set<SlashBlocker>>;
  /** player 索引 → 该玩家当前注册的豁免器集合 */
  exemptors: Map<number, Set<SlashExemptor>>;
}

const slashRegistries = new WeakMap<GameState, SlashRegistry>();

function getSlashRegistry(state: GameState): SlashRegistry {
  let reg = slashRegistries.get(state);
  if (!reg) {
    reg = {
      quotaProviders: new Map(),
      extraProviders: new Map(),
      unlimitedProviders: new Map(),
      blockers: new Map(),
      exemptors: new Map(),
    };
    slashRegistries.set(state, reg);
  }
  return reg;
}

/** 通用注册:把 provider 加入 owner 桶,返回取消注册函数。 */
function addToRegistry<T>(
  reg: SlashRegistry,
  bucket: keyof Pick<SlashRegistry, 'quotaProviders' | 'extraProviders' | 'unlimitedProviders' | 'blockers' | 'exemptors'>,
  ownerId: number,
  provider: T,
): () => void {
  const map = reg[bucket] as Map<number, Set<T>>;
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
 * 注册一个额定上限提供者(技能 onInit 时调用,与 registerAction 同构)。
 * 返回取消注册函数——技能 onInit 应将其并入返回的 unload,由 setSkillInstanceUnload
 * 统一管理,卸载技能实例时自动清理。
 */
export function registerSlashQuotaProvider(
  state: GameState,
  ownerId: number,
  provider: SlashQuotaProvider,
): () => void {
  return addToRegistry(getSlashRegistry(state), 'quotaProviders', ownerId, provider);
}

/**
 * 注册一个额外次数提供者(技能 onInit 时调用)。
 * 返回取消注册函数——应并入 onInit 返回的 unload。
 */
export function registerSlashExtraProvider(
  state: GameState,
  ownerId: number,
  provider: SlashExtraProvider,
): () => void {
  return addToRegistry(getSlashRegistry(state), 'extraProviders', ownerId, provider);
}

/**
 * 注册一个无限出杀提供者(技能 onInit 时调用)。返回 true 则该玩家本回合出杀无上限。
 * 返回取消注册函数——应并入 onInit 返回的 unload。
 */
export function registerSlashUnlimitedProvider(
  state: GameState,
  ownerId: number,
  provider: SlashUnlimitedProvider,
): () => void {
  return addToRegistry(getSlashRegistry(state), 'unlimitedProviders', ownerId, provider);
}

/**
 * @deprecated 改用 registerSlashQuotaProvider / registerSlashExtraProvider /
 * registerSlashUnlimitedProvider。本函数路由到额定提供者(max 语义)。
 */
export function registerSlashMaxProvider(
  state: GameState,
  ownerId: number,
  provider: SlashMaxProvider,
): () => void {
  return registerSlashQuotaProvider(state, ownerId, provider);
}

/**
 * 该玩家本回合的额定出杀上限。基础 1;各额定提供者取最大(覆盖型)。
 */
export function slashQuotaMax(state: GameState, player: number): number {
  let max = 1; // 基础额定上限
  const set = getSlashRegistry(state).quotaProviders.get(player);
  if (set) {
    for (const fn of set) {
      const v = fn(state, player);
      if (v > max) max = v;
    }
  }
  return max;
}

/**
 * 该玩家本回合的额外出杀次数。各额外提供者求和(叠加型)。
 */
export function slashExtraMax(state: GameState, player: number): number {
  let sum = 0;
  const set = getSlashRegistry(state).extraProviders.get(player);
  if (set) {
    for (const fn of set) {
      sum += fn(state, player);
    }
  }
  return sum;
}

/** 该玩家本回合是否出杀无上限(任一无限提供者返回 true)。 */
export function isSlashUnlimited(state: GameState, player: number): boolean {
  const set = getSlashRegistry(state).unlimitedProviders.get(player);
  if (!set) return false;
  for (const fn of set) {
    if (fn(state, player)) return true;
  }
  return false;
}

/**
 * 该玩家本回合的出杀次数上限。
 * 无限提供者命中 → ∞;否则 额定(quota) + 额外(extra)。
 */
export function slashMax(state: GameState, player: number): number {
  if (isSlashUnlimited(state, player)) return Infinity;
  return slashQuotaMax(state, player) + slashExtraMax(state, player);
}

/** 该玩家本回合额定已用次数(默认 0) */
export function slashQuotaUsed(state: GameState): number {
  const used = state.turn.vars[QUOTA_USED_VAR] as number | undefined;
  return typeof used === 'number' ? used : 0;
}

/** 该玩家本回合额外已用次数(默认 0) */
export function slashExtraUsed(state: GameState): number {
  const used = state.turn.vars[EXTRA_USED_VAR] as number | undefined;
  return typeof used === 'number' ? used : 0;
}

/** 当前玩家本回合已出杀次数(额定 + 额外,默认 0) */
export function slashUsed(state: GameState): number {
  return slashQuotaUsed(state) + slashExtraUsed(state);
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
  return addToRegistry(getSlashRegistry(state), 'blockers', ownerId, blocker);
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
  return addToRegistry(getSlashRegistry(state), 'exemptors', ownerId, exemptor);
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

/** 记录一次出杀(已用次数 +1,优先扣额定,额定满后扣额外)。在杀 use 的 execute 末尾调用 */
export function incSlashUsed(state: GameState): void {
  const player = state.currentPlayerIndex;
  if (slashQuotaUsed(state) < slashQuotaMax(state, player)) {
    state.turn.vars[QUOTA_USED_VAR] = slashQuotaUsed(state) + 1;
  } else {
    state.turn.vars[EXTRA_USED_VAR] = slashExtraUsed(state) + 1;
  }
}
