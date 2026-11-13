// 出杀次数上限计算——查询型提供者模式(与 registerAction/registerBeforeHook 同构)。
//
// 三层模型(对齐 docs/architecture/出牌流程重设计.md 模块 K / condition.md):
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

import type { GameState } from '../types';
import { registerAfterHook } from '../core/skill';
import { createProviderRegistry } from './provider-registry';
import { setTurnUsage, projectTurnUsage } from './turn-usage';
import { getSlashQuotaUsed, getSlashExtraUsed, slashQuotaUsedKey, slashExtraUsedKey, slashExtraKey, slashUnlimitedKey, slashBlockedKey, SLASH_QUOTA_USED_KEY as QUOTA_USED_VAR, SLASH_EXTRA_USED_KEY as EXTRA_USED_VAR, SLASH_USED_COUNT_KEY } from './vars-keys';

/**
 * view 侧"已出杀次数"投影 key(由「回合用量」atom 同步到 view.turnUsage)。
 * 历史上也是 state 计数 vars key;模块 K 拆分后 state 改用 杀/quotaUsed + 杀/extraUsed,
 * 本常量保留为 view 投影 key(viewSlashUsed / 前端 turnUsage 消费),值 = slashUsed() 合计。
 */
export const SLASH_USED_VAR = SLASH_USED_COUNT_KEY;

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

// ─── state-bound 注册表(WeakMap 外挂,随 state 自动隔离/GC,样板见 rules/provider-registry.ts) ───

const quotaRegistry = createProviderRegistry<SlashQuotaProvider>();
const extraRegistry = createProviderRegistry<SlashExtraProvider>();
const unlimitedRegistry = createProviderRegistry<SlashUnlimitedProvider>();
const blockerRegistry = createProviderRegistry<SlashBlocker>();
const exemptorRegistry = createProviderRegistry<SlashExemptor>();

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
  return quotaRegistry.register(state, ownerId, provider);
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
  return extraRegistry.register(state, ownerId, provider);
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
  return unlimitedRegistry.register(state, ownerId, provider);
}

/**
 * 该玩家本回合的额定出杀上限。基础 1;各额定提供者取最大(覆盖型)。
 */
export function slashQuotaMax(state: GameState, player: number): number {
  let max = 1; // 基础额定上限
  quotaRegistry.forEachOf(state, player, (fn) => {
    const v = fn(state, player);
    if (v > max) max = v;
  });
  return max;
}

/**
 * 该玩家本回合的额外出杀次数。各额外提供者求和(叠加型)。
 */
export function slashExtraMax(state: GameState, player: number): number {
  let sum = 0;
  extraRegistry.forEachOf(state, player, (fn) => {
    sum += fn(state, player);
  });
  return sum;
}

/** 该玩家本回合是否出杀无上限(任一无限提供者返回 true)。 */
export function isSlashUnlimited(state: GameState, player: number): boolean {
  return unlimitedRegistry.someOf(state, player, (fn) => fn(state, player));
}

/**
 * 该玩家本回合的出杀次数上限。
 * 无限提供者命中 → ∞;否则 额定(quota) + 额外(extra)。
 */
export function slashMax(state: GameState, player: number): number {
  if (isSlashUnlimited(state, player)) return Infinity;
  return slashQuotaMax(state, player) + slashExtraMax(state, player);
}

/** 该玩家本回合额定已用次数(默认 0)。旧测试/存档的无玩家 key 仅归当前回合玩家。 */
export function slashQuotaUsed(state: GameState, player = state.currentPlayerIndex): number {
  const legacy = getSlashQuotaUsed(state.turn.vars);
  if (player === state.currentPlayerIndex && legacy !== undefined) return legacy;
  return getSlashQuotaUsed(state.turn.vars, player) ?? 0;
}

/** 该玩家本回合额外已用次数(默认 0)。旧测试/存档的无玩家 key 仅归当前回合玩家。 */
export function slashExtraUsed(state: GameState, player = state.currentPlayerIndex): number {
  const legacy = getSlashExtraUsed(state.turn.vars);
  if (player === state.currentPlayerIndex && legacy !== undefined) return legacy;
  return getSlashExtraUsed(state.turn.vars, player) ?? 0;
}

/** 当前玩家本回合已出杀次数(额定 + 额外,默认 0)。 */
export function slashUsed(state: GameState, player = state.currentPlayerIndex): number {
  return slashQuotaUsed(state, player) + slashExtraUsed(state, player);
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
  return blockerRegistry.register(state, ownerId, blocker);
}

/** 该玩家本回合是否被阻断出杀(任一阻断器返回 true 即阻断) */
export function isSlashBlocked(state: GameState, player: number): boolean {
  return blockerRegistry.someOf(state, player, (fn) => fn(state, player));
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
  return exemptorRegistry.register(state, ownerId, exemptor);
}

/** 该玩家当前使用的这张【杀】是否豁免出杀次数(任一豁免器返回 true 即豁免)。
 *  cardId 缺省时只问"无卡牌上下文"的豁免器(目前无此用例,恒返回 false)。 */
export function isSlashExempted(
  state: GameState,
  player: number,
  cardId: string | undefined,
): boolean {
  if (cardId === undefined) return false;
  return exemptorRegistry.someOf(state, player, (fn) => fn(state, player, cardId));
}

/** 当前玩家是否还能出杀(未被阻断 且 额定/额外次数至少一层未达上限)。
 *  cardId 可选:若提供且该卡被任一豁免器命中,则绕过次数上限检查。
 *  无限出杀(诸葛连弩/咆哮)始终放行。
 *  否则按文档两层 OR 判断:quotaUsed < quotaMax || extraUsed < extraMax
 *  (即"不能出杀" = 额定达上限 AND 额外达上限)。 */
export function canSlash(
  state: GameState,
  player: number,
  cardId?: string,
): boolean {
  if (isSlashBlocked(state, player)) return false;
  if (cardId !== undefined && isSlashExempted(state, player, cardId)) return true;
  if (isSlashUnlimited(state, player)) return true;
  return slashQuotaUsed(state, player) < slashQuotaMax(state, player)
    || slashExtraUsed(state, player) < slashExtraMax(state, player);
}

/** 记录一次出杀(已用次数 +1)。
 *  无限出杀(诸葛连弩/咆哮)时始终计入 quotaUsed(不计入 extraUsed),
 *  即使超过 quotaMax 也不动 extraUsed——文档规定无限出杀的杀只计入额定次数。
 *  否则优先扣额定,额定满后扣额外。在杀 use 的 execute 末尾调用。 */
export async function incSlashUsed(state: GameState, player = state.currentPlayerIndex): Promise<void> {
  const quota = slashQuotaUsed(state, player);
  const extra = slashExtraUsed(state, player);
  if (isSlashUnlimited(state, player) || quota < slashQuotaMax(state, player)) {
    const value = quota + 1;
    await setTurnUsage(state, player, SLASH_USED_COUNT_KEY, value + extra, [
      { scope: 'turn', key: slashQuotaUsedKey(player), value },
      ...(player === state.currentPlayerIndex ? [{ scope: 'turn' as const, key: QUOTA_USED_VAR, value }] : []),
    ]);
  } else {
    const value = extra + 1;
    await setTurnUsage(state, player, SLASH_USED_COUNT_KEY, quota + value, [
      { scope: 'turn', key: slashExtraUsedKey(player), value },
      ...(player === state.currentPlayerIndex ? [{ scope: 'turn' as const, key: EXTRA_USED_VAR, value }] : []),
    ]);
  }
}

// ─── view 投影 helper(杀/* 前缀键族单点) ────────────────────
//
// 技能放宽出杀限制时,engine 侧真相由 provider(blocker/exemptor 等)承载,
// view 侧必须同步投影到 turnUsage 的 '杀/<族>/<来源>' 前缀键——前端 viewSlashMax/
// viewCanSlash 与无头枚举按前缀聚合;漏投影 = 引擎放行但客户端发不出动作。
// 各技能原先手写完整的「回合用量」atom 字面量,统一收敛到此处,
// 来源字符串(= 技能名)即 key 的唯一登记点。

/** 投影「本回合额外出杀次数 +extra」到 view.turnUsage['杀/extra/<来源>']。
 *  前端 viewSlashMax 按 '杀/extra/' 前缀求和推断上限(天义/界将驰/决堰/奇谋/界鞬出/立军/诈降 等)。 */
export async function projectSlashExtra(
  state: GameState,
  player: number,
  source: string,
  extra: number,
): Promise<void> {
  await projectTurnUsage(state, player, slashExtraKey(source), extra);
}

/** 投影「本回合无限出杀」到 view.turnUsage['杀/unlimited/<来源>']。
 *  前端 viewSlashMax 按 '杀/unlimited/' 前缀任一真值判定 ∞(咆哮/界咆哮/界父魂/雄乱/成略 等)。 */
export async function projectSlashUnlimited(
  state: GameState,
  player: number,
  source: string,
): Promise<void> {
  await projectTurnUsage(state, player, slashUnlimitedKey(source), true);
}

/** 投影「本回合禁止出杀」到 view.turnUsage['杀/blocked/<来源>']。
 *  前端 viewCanSlash 按 '杀/blocked/' 前缀任一真值判定禁杀(界将驰 选项① 等)。 */
export async function projectSlashBlocked(
  state: GameState,
  player: number,
  source: string,
): Promise<void> {
  await projectTurnUsage(state, player, slashBlockedKey(source), true);
}

/**
 * 注册「无条件无限出杀 + view 投影」组合(咆哮/界咆哮 样板收敛):
 *   1. 无限出杀提供者(恒 true)→ slashMax = ∞,本回合出杀无次数限制;
 *   2. 拥有者每个出牌阶段开始时把 '杀/unlimited/<skillId>' 投影到 view.turnUsage
 *      (回合结束自动清空)——前端/MCP 客户端的 viewSlashMax 据此推断无限出杀;
 *      缺失则首次出杀后(usedCount=1 ≥ max 1)viewCanSlash 误判为 false,
 *      【杀】从 availableActions 消失。
 * skillId 既是 hook 注册 key 又是投影来源字符串(= 技能名;视图键前缀
 * '杀/unlimited/' 由 slashUnlimitedKey 内拼,CLAUDE.md view 投影契约)。
 * 返回取消注册函数——应并入 onInit 返回的 unload。
 */
export function registerAlwaysUnlimitedWithProjection(
  state: GameState,
  skillId: string,
  ownerId: number,
): () => void {
  const unregMax = registerSlashUnlimitedProvider(state, ownerId, () => true);
  const unregHook = registerAfterHook(state, skillId, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    await projectSlashUnlimited(ctx.state, ownerId, skillId);
  });
  return () => {
    unregMax();
    unregHook();
  };
}
