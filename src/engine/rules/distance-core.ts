// src/engine/rules/distance-core.ts
// 距离纯计算核:环形座位距离公式、存活序号定位、±修正应用、攻击范围比较。
//
// 引擎侧(rules/distance.ts,数据来自 GameState)与 view 侧(rules/viewDistance.ts,
// 数据来自 GameView)是同一公式的两份数据适配层——公式在此唯一实现,防止手写两份漂移。
// 行为等价由 tests/engine/distance-parity.test.ts 逐座次对锁定。
//
// 本模块不 import 任何 GameState/GameView 类型:输入只是座次表/存活数/序号/修正数等原始值。
// 「未命中存活序列 → Infinity」与「存活 ≤ 1 → 0」两个守卫的先后顺序两侧不同
// (state 先查未命中、view 先查存活数),由两侧适配层各自保留,不在核内合并。

/** 座次表条目的最小形状(定位用):GameState.players / GameView.players 的条目均满足。 */
interface SeatEntry {
  /** 座次号(环形座位上的绝对位置) */
  index: number;
}

/** 在存活序列(已按 alive 过滤的子列)中按座次号定位 0-based 序号。
 *  不在序列中(已死亡/不存在)返回 -1,由调用方守卫。 */
export function aliveSeatOrdinal(alive: readonly SeatEntry[], seat: number): number {
  return alive.findIndex((p) => p.index === seat);
}

/** 环形座位距离公式:两人之间最短的顺/逆时针步数(只算存活玩家)。
 *  fromOrdinal/toOrdinal 为 aliveSeatOrdinal 求得的存活序号;存活 ≤ 1 时返回 0。 */
export function ringSeatDistance(aliveCount: number, fromOrdinal: number, toOrdinal: number): number {
  if (aliveCount <= 1) return 0;
  const d = Math.abs(fromOrdinal - toOrdinal);
  return Math.min(d, aliveCount - d);
}

/** 座位距离 ± 修正 → 实际距离(下限 1)。
 *  进攻修正 attackMod 为正 = 缩短距离(进攻马/马术);防御修正 defenseMod 为正 = 增加距离(防御马)。
 *  Infinity(未命中存活序列)原样透传:∞ ± 有限数仍为 ∞,max(1, ∞) = ∞。 */
export function applyDistanceMods(seatDist: number, attackMod: number, defenseMod: number): number {
  return Math.max(1, seatDist - attackMod + defenseMod);
}

/** 攻击范围比较:实际距离 ≤ 攻击范围即放行(徒手默认 1 由调用方取值后传入)。 */
export function withinAttackRange(effDist: number, attackRange: number): boolean {
  return effDist <= attackRange;
}
