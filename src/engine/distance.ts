// src/engine/distance.ts
// 距离计算:环形座位距离 + 技能/装备修正(通过 player.vars)

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
 * = 座位距离 + to 的防御修正 - from 的进攻修正,最小 1。
 *
 * 修正来源(技能/装备通过 player.vars 设置):
 *   vars['距离/进攻修正'] — 进攻马、马术等缩短距离的技能(正值=缩短)
 *   vars['距离/防御修正'] — 防御马等增加距离的技能(正值=增加)
 */
export function effectiveDistance(state: GameState, from: number, to: number): number {
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
 */
export function inAttackRange(state: GameState, from: number, to: number): boolean {
  if (from === to) return false;
  const range = (state.players[from].vars['距离/出杀范围'] as number) ?? 1;
  return effectiveDistance(state, from, to) <= range;
}
