// src/client/utils/distance.ts
// 纯函数距离/范围计算,基于 GameView(无 engine state,无 React state)
// 用于前端 UI 选目标高亮/距离检查;引擎侧用 src/engine/distance.ts(走 GameState + vars)。
import type { GameView, Card } from '../../engine/types';

/**
 * 计算 from 到 to 的环形座位距离(只算存活玩家)
 * @param players GameView.players
 * @param fromIdx 起始玩家下标(对应 view.players)
 * @param toIdx 目标玩家下标
 * @returns 座位距离;任一方不在存活列表中时返回 Infinity
 */
export function seatDistance(players: GameView['players'], fromIdx: number, toIdx: number): number {
  const alive = players.filter(p => p.alive);
  const n = alive.length;
  if (n <= 1) return 0;
  const aliveFromIdx = alive.findIndex(p => p.name === players[fromIdx]?.name);
  const aliveToIdx = alive.findIndex(p => p.name === players[toIdx]?.name);
  if (aliveFromIdx < 0 || aliveToIdx < 0) return Infinity;
  const d = Math.abs(aliveFromIdx - aliveToIdx);
  return Math.min(d, n - d);
}

/**
 * 计算 from 到 to 的实际距离(含马修正)
 * 进攻修正(进攻马/马术):距离 -进攻Mod;防御修正(防御马):距离 +防御Mod;最小值为 1
 * 与引擎 distance.ts 的 effectiveDistance 用同一套 vars(distanceVars 投影)。
 * @returns 实际距离(>= 1)
 */
export function effectiveDist(players: GameView['players'], fromIdx: number, toIdx: number): number {
  let dist = seatDistance(players, fromIdx, toIdx);
  const fromP = players[fromIdx];
  const toP = players[toIdx];
  // 进攻修正:缩短距离(进攻马/马术等技能设此 var)
  const attackMod = fromP?.distanceVars?.attackMod ?? 0;
  dist -= attackMod;
  // 防御修正:增加距离(防御马等技能设此 var)
  const defenseMod = toP?.distanceVars?.defenseMod ?? 0;
  dist += defenseMod;
  return Math.max(1, dist);
}

/**
 * from 是否能攻击到 to(基于 from 的出杀范围;徒手默认 1)
 * 出杀范围来自 distanceVars.attackRange(武器/诸葛连弩等在装备时设值)
 */
export function canAttack(
  players: GameView['players'],
  cardMap: Record<string, Card>,
  fromIdx: number,
  toIdx: number,
): boolean {
  const fromP = players[fromIdx];
  const range = fromP?.distanceVars?.attackRange ?? 1;
  return effectiveDist(players, fromIdx, toIdx) <= range;
}