// src/engine/distance.ts
// 距离计算:环形座位距离 + 技能/装备修正(通过 player.vars)
//
// 扩展点:inAttackRange 接 registerAttackRangeExemptor 注册的豁免器(predicate),
// 用于"特定条件下杀无距离限制"类效果。引擎/距离模块不感知具体技能,
// 各技能自行注册 predicate 判定是否豁免。
// 注册表为 state-bound(WeakMap 外挂),随 state 自动隔离/GC,与 slash-quota/hand-limit 同构。

import type { GameState } from './types';

/**
 * 环形座位距离(只算存活玩家)。
 * 两人之间最短的顺时针/逆时针步数,跳过死亡玩家。
 */
function seatDistance(aliveCount: number, fromIdx: number, toIdx: number): number {
  if (aliveCount <= 1) return 0;
  const d = Math.abs(fromIdx - toIdx);
  return Math.min(d, aliveCount - d);
}

/**
 * 两人之间的实际距离(from 看 to)。
 * = 座位距离 + to 的防御修正 - from 的进攻修正，最小 1。
 *
 * 修正来源(技能/装备通过 player.vars 设置):
 *   vars['距离/进攻修正'] — 进攻马、马术等缩短距离的技能(正值=缩短)
 *   vars['距离/防御修正'] — 防御马等增加距离的技能(正值=增加)
 *
 * 扩展点:registerDistanceExemptor 注册的豁免器命中时返回 1(视为无距离限制)。
 * 用于"特定条件下用牌无距离限制"类效果(界陷阵拼点赢后对其用牌无距离等)。
 */
export function effectiveDistance(state: GameState, from: number, to: number): number {
  // 豁免器命中视为距离 1(可被所有距离检查放行)。
  if (isDistanceExempted(state, from, to)) return 1;
  const alive = state.players.filter((p) => p.alive);
  const aliveFrom = alive.findIndex((p) => p.index === from);
  const aliveTo = alive.findIndex((p) => p.index === to);
  if (aliveFrom < 0 || aliveTo < 0) return Infinity;
  let dist = seatDistance(alive.length, aliveFrom, aliveTo);
  // 进攻修正:缩短距离(进攻马/马术)
  const attackMod = (state.players[from].vars['距离/进攻修正'] as number) ?? 0;
  dist -= attackMod;
  // 防御修正:增加距离(防御马)
  const defenseMod = (state.players[to].vars['距离/防御修正'] as number) ?? 0;
  dist += defenseMod;
  return Math.max(1, dist);
}

/**
 * from 是否能对 to 使用【杀】(出杀距离)。
 * = effectiveDistance(from, to) <= from 的出杀范围
 *
 * 出杀范围来源(技能/装备通过 player.vars 设置):
 *   vars['距离/出杀范围'] — 武器攻击范围,默认 1(徒手)。诸葛连弩/青釭剑等在装备时设值
 *
 * cardId 可选:用于 per-card 距离豁免(如界当先特定卡牌无距离、界武圣方片杀无距离)。
 * 豁免逻辑由 registerAttackRangeExemptor 注册的 provider 提供,本函数不感知具体技能。
 */
export function inAttackRange(
  state: GameState,
  from: number,
  to: number,
  cardId?: string,
): boolean {
  if (from === to) return false;
  if (isAttackRangeExempted(state, from, to, cardId)) return true;
  const range = (state.players[from].vars['距离/出杀范围'] as number) ?? 1;
  return effectiveDistance(state, from, to) <= range;
}

// ─── 攻击范围豁免器(state-bound 注册表,镜像 slash-quota 的 provider 模式) ───

/**
 * 攻击范围豁免器:返回 true 表示 from 对 to 的此张【杀】无视距离限制。
 * cardId 可选,用于 per-card 判定(如界武圣的方片杀、界当先的特定卡牌)。
 * 用于"杀无距离限制"类效果(天义/界弓骑/界陷阵/界武圣/界将驰/界当先/界烈弓/诈降等)。
 */
export type AttackRangeExemptor = (
  state: GameState,
  from: number,
  to: number,
  cardId: string | undefined,
) => boolean;

/**
 * 通用距离豁免器:返回 true 表示 from→to 视为距离 1(可被所有距离检查放行)。
 * 用于"用牌无距离限制"类效果(界陷阵:拼点赢后对其用牌无距离)。
 * 与 AttackRangeExemptor 的区别:后者只覆盖【杀】;前者覆盖所有 distance-based 检查
 * (顺手牵羊/过河拆桥等)。效果重叠时(如界陷阵同时覆盖杀与其他牌),应同时注册两者。
 */
export type DistanceExemptor = (
  state: GameState,
  from: number,
  to: number,
) => boolean;

interface DistanceRegistry {
  /** player 索引 → 该玩家注册的【杀】攻击范围豁免器集合 */
  exemptors: Map<number, Set<AttackRangeExemptor>>;
  /** player 索引 → 该玩家注册的通用距离豁免器集合 */
  distanceExemptors: Map<number, Set<DistanceExemptor>>;
}

const distanceRegistries = new WeakMap<GameState, DistanceRegistry>();

function getDistanceRegistry(state: GameState): DistanceRegistry {
  let reg = distanceRegistries.get(state);
  if (!reg) {
    reg = { exemptors: new Map(), distanceExemptors: new Map() };
    distanceRegistries.set(state, reg);
  }
  return reg;
}

/**
 * 注册一个攻击范围豁免器(技能 onInit 时调用)。
 * 返回的取消注册函数应并入 onInit 返回的 unload,由 setSkillInstanceUnload 统一清理。
 */
export function registerAttackRangeExemptor(
  state: GameState,
  ownerId: number,
  exemptor: AttackRangeExemptor,
): () => void {
  const reg = getDistanceRegistry(state);
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

/** 该 from→to 的此张【杀】是否被任一豁免器放行(任一返回 true 即放行)。 */
export function isAttackRangeExempted(
  state: GameState,
  from: number,
  to: number,
  cardId: string | undefined,
): boolean {
  const set = getDistanceRegistry(state).exemptors.get(from);
  if (!set) return false;
  for (const fn of set) {
    if (fn(state, from, to, cardId)) return true;
  }
  return false;
}

/**
 * 注册一个通用距离豁免器(技能 onInit 时调用)。
 * 返回的取消注册函数应并入 onInit 返回的 unload,由 setSkillInstanceUnload 统一清理。
 */
export function registerDistanceExemptor(
  state: GameState,
  ownerId: number,
  exemptor: DistanceExemptor,
): () => void {
  const reg = getDistanceRegistry(state);
  let set = reg.distanceExemptors.get(ownerId);
  if (!set) {
    set = new Set();
    reg.distanceExemptors.set(ownerId, set);
  }
  set.add(exemptor);
  return () => {
    const s = reg.distanceExemptors.get(ownerId);
    if (s) {
      s.delete(exemptor);
      if (s.size === 0) reg.distanceExemptors.delete(ownerId);
    }
  };
}

/** 该 from→to 是否被任一通用距离豁免器放行(任一返回 true 即视为距离 1)。 */
export function isDistanceExempted(state: GameState, from: number, to: number): boolean {
  const set = getDistanceRegistry(state).distanceExemptors.get(from);
  if (!set) return false;
  for (const fn of set) {
    if (fn(state, from, to)) return true;
  }
  return false;
}
