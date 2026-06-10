// src/engine/distance.ts
// 距离计算:座位距离 + 装备修正 + 武器范围

import type { GameState } from './types';

/** 武器名 → 攻击范围 */
const WEAPON_RANGE: Record<string, number> = {
  '诸葛连弩': 1, '青釭剑': 2, '雌雄双股剑': 2, '贯石斧': 3,
  '青龙偃月刀': 3, '丈八蛇矛': 3, '方天画戟': 4, '麒麟弓': 5, '寒冰剑': 2,
};

/** 环形座位距离(只算存活玩家) */
function seatDist(aliveCount: number, fromIdx: number, toIdx: number): number {
  if (aliveCount <= 1) return 0;
  const d = Math.abs(fromIdx - toIdx);
  return Math.min(d, aliveCount - d);
}

/** 两人之间的实际距离 */
export function effectiveDistance(state: GameState, from: string, to: string): number {
  const alive = state.players.filter(p => p.alive);
  const aliveFrom = alive.findIndex(p => p.name === from);
  const aliveTo = alive.findIndex(p => p.name === to);
  if (aliveFrom < 0 || aliveTo < 0) return Infinity;
  let dist = seatDist(alive.length, aliveFrom, aliveTo);
  // 进攻马:缩短距离
  const fromPlayer = state.players.find(p => p.name === from);
  if (fromPlayer?.equipment?.['进攻马']) dist -= 1;
  // 防御马:增加距离
  const toPlayer = state.players.find(p => p.name === to);
  if (toPlayer?.equipment?.['防御马']) dist += 1;
  return Math.max(1, dist);
}

/** 是否在攻击范围内 */
export function inAttackRange(state: GameState, from: string, to: string): boolean {
  const fromPlayer = state.players.find(p => p.name === from);
  let range = 1;
  if (fromPlayer?.equipment?.['武器']) {
    const weapon = state.cardMap[fromPlayer.equipment['武器']];
    if (weapon) range = WEAPON_RANGE[weapon.name] ?? 1;
  }
  return effectiveDistance(state, from, to) <= range;
}
