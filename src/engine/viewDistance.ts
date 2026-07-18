// src/engine/viewDistance.ts
// 基于 GameView(前端投影视图)的距离/攻击范围计算。
//
// 设计:这些函数不依赖完整 GameState(不访问 player.vars 原始 key),
// 只用 GameView.players[].distanceVars 投影——前后端共享同一套语义。
//
// 用途:技能 onMount 的 defineAction prompt.targetFilter.filter 调用,
// 让前端 UI 能在不访问 GameState 的情况下判断距离/攻击范围(高亮/禁用)。
// 后端 validate 始终是最终权威检查(用 src/engine/distance.ts 基于 GameState)。
//
// 注:src/client/utils/distance.ts 的同名函数语义一致,前端组件可直接用本模块,
// 也可继续用 client util(两者基于同一套 distanceVars 投影)。

import type { GameView } from './types';

/** GameView 上 from 到 to 的环形座位距离(只算存活玩家) */
export function viewSeatDistance(
  players: GameView['players'],
  fromIdx: number,
  toIdx: number,
): number {
  const alive = players.filter((p) => p.alive);
  const n = alive.length;
  if (n <= 1) return 0;
  const aliveFrom = alive.findIndex((p) => p.name === players[fromIdx]?.name);
  const aliveTo = alive.findIndex((p) => p.name === players[toIdx]?.name);
  if (aliveFrom < 0 || aliveTo < 0) return Infinity;
  const d = Math.abs(aliveFrom - aliveTo);
  return Math.min(d, n - d);
}

/** GameView 上 from 到 to 的实际距离(含马修正,>= 1) */
export function viewEffectiveDistance(
  players: GameView['players'],
  fromIdx: number,
  toIdx: number,
): number {
  let dist = viewSeatDistance(players, fromIdx, toIdx);
  const fromP = players[fromIdx];
  const toP = players[toIdx];
  // 进攻修正:缩短距离(进攻马/马术等)
  dist -= fromP?.distanceVars?.attackMod ?? 0;
  // 防御修正:增加距离(防御马等)
  dist += toP?.distanceVars?.defenseMod ?? 0;
  return Math.max(1, dist);
}

/** GameView 上 from 是否能对 to 出杀(基于 from 的攻击范围,徒手默认 1) */
export function viewCanAttack(
  players: GameView['players'],
  cardMap: Record<string, unknown>,
  fromIdx: number,
  toIdx: number,
): boolean {
  void cardMap; // 签名与 client utils/distance 对齐,GameView 投影不需要 cardMap
  if (fromIdx === toIdx) return false;
  // 诈降(界黄盖):失去体力后本回合【红色杀】无距离限制。turnUsage 由回合用量 atom 同步。
  // 前端 filter 无法感知当前选中的卡色(签名只收 view/target),这里保持宽松——
  // 诈降激活时一律放行(UI 提示);后端 杀.validate 按卡色严格校验(仅红杀放行)。
  if (players[fromIdx]?.turnUsage?.['诈降/active']) return true;
  // 界武圣(界关羽):你使用的方片【杀】无距离限制。前端 filter 无法感知选中卡色,
  // 保持宽松(所有目标可点);后端 杀.validate 按花色严格校验(仅方片杀放行)。
  if (players[fromIdx]?.skills?.includes('界武圣')) return true;
  const range = players[fromIdx]?.distanceVars?.attackRange ?? 1;
  return viewEffectiveDistance(players, fromIdx, toIdx) <= range;
}
