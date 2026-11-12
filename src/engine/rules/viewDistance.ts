// src/engine/rules/viewDistance.ts
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

import type { GameView } from '../types';
import {
  XIANZHEN_WIN_TARGET_VIEW_KEY,
  CHENGLUE_SUITS_VIEW_KEY,
  JIANGCHI_CHOICE2_VIEW_KEY,
  GONGQI_ACTIVE_VIEW_KEY,
  DANGXIAN_NO_RANGE_VIEW_KEY,
  TIANYI_WIN_VIEW_KEY,
  JUEYAN_MOUNT_VIEW_KEY,
  WANGLIE_FIRST_VIEW_KEY,
  XIONGLUAN_TARGET_VIEW_KEY,
  slashExtraKey,
} from './vars-keys';

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

// ─── 距离/攻击范围豁免登记表 ─────────────────────────────────
//
// 引擎侧各技能通过 registerDistanceExemptor / registerAttackRangeExemptor 注册豁免器
// (src/engine/rules/distance.ts);view 侧原先在 viewEffectiveDistance / viewCanAttack
// 各自手写 if 链,同一技能写两遍易漂移。现以单一登记表驱动两个查询函数,
// kinds 与引擎侧注册严格对应(以各技能文件的 register* 调用为准):
//   'distance'    = registerDistanceExemptor(通用距离豁免:所有 distance-based 检查。
//                   viewEffectiveDistance 视为 1;viewCanAttack 经「距离 1 ≤ 攻击范围」放行,
//                   与引擎 inAttackRange 内部调 effectiveDistance 同构)
//   'attackRange' = registerAttackRangeExemptor(仅【杀】的攻击范围豁免:
//                   viewCanAttack 直接放行,不影响 viewEffectiveDistance——
//                   引擎侧它也不缩短顺手牵羊等锦囊的距离)
//
// 注意:前端 filter 无法感知当前选中卡的花色/点数,per-card 豁免(成略/诈降/界武圣/
// 界烈弓/界当先)在此保持宽松(激活即放行);后端 validate 按 cardId 严格校验。

type DistanceExemptKind = 'distance' | 'attackRange';

interface ViewDistanceExemption {
  /** 豁免来源技能名(排查/注释定位用) */
  source: string;
  /** 引擎侧注册的豁免器种类(与技能文件的 register* 调用一一对应) */
  kinds: readonly DistanceExemptKind[];
  /** 基于投影(turnUsage / skills)判定该豁免当前是否命中 */
  matches: (players: GameView['players'], fromIdx: number, toIdx: number) => boolean;
}

const VIEW_DISTANCE_EXEMPTIONS: readonly ViewDistanceExemption[] = [
  {
    // 界陷阵(界高顺):拼点赢后对其用牌无距离限制。turnUsage 由 回合用量 atom 同步;
    // winTarget 存目标座次。注:GameView 不携带 currentPlayerIndex 区分发起方,
    // 这里宽松匹配(可被所有距离检查放行);后端 distance.ts effectiveDistance
    // 严格按 turn.vars 校验(仅对持有界陷阵技能的发起方生效)。
    source: '界陷阵',
    kinds: ['distance'],
    matches: (players, _fromIdx, toIdx) =>
      players.some((p) => p.turnUsage?.[XIANZHEN_WIN_TARGET_VIEW_KEY] === toIdx),
  },
  {
    // 成略(许攸):本阶段同花色牌无距离和次数限制。turnUsage['成略/suits'] 由回合用量 atom 同步。
    // 引擎侧同时注册 AttackRangeExemptor(杀)与 DistanceExemptor(顺手牵羊/兵粮寸断)。
    source: '成略',
    kinds: ['distance', 'attackRange'],
    matches: (players, fromIdx) => !!players[fromIdx]?.turnUsage?.[CHENGLUE_SUITS_VIEW_KEY],
  },
  {
    // 决堰(界姜维):坐骑栏效果——本回合使用牌无距离限制 → 距离视为 1。
    source: '决堰',
    kinds: ['distance'],
    matches: (players, fromIdx) => !!players[fromIdx]?.turnUsage?.[JUEYAN_MOUNT_VIEW_KEY],
  },
  {
    // 往烈(界朱然):本回合使用的首张牌无距离限制 → 距离视为 1。
    source: '往烈',
    kinds: ['distance'],
    matches: (players, fromIdx) => !!players[fromIdx]?.turnUsage?.[WANGLIE_FIRST_VIEW_KEY],
  },
  {
    // 雄乱(界吕布):本回合对其使用牌无距离限制(值=目标座次)。
    source: '雄乱',
    kinds: ['distance'],
    matches: (players, fromIdx, toIdx) =>
      players[fromIdx]?.turnUsage?.[XIONGLUAN_TARGET_VIEW_KEY] === toIdx,
  },
  {
    // 天义(太史慈):拼点赢后本回合攻击范围无限(值=发起者座次)。仅覆盖杀(攻击范围豁免)。
    source: '天义',
    kinds: ['attackRange'],
    matches: (players, fromIdx) =>
      players[fromIdx]?.turnUsage?.[TIANYI_WIN_VIEW_KEY] === fromIdx,
  },
  {
    // 诈降(界黄盖):失去体力后本回合【红色杀】无距离限制。turnUsage 由回合用量 atom 同步。
    // 宽松放行(UI 提示);后端 杀.validate 按卡色严格校验(仅红杀放行)。
    source: '诈降',
    kinds: ['attackRange'],
    matches: (players, fromIdx) => !!players[fromIdx]?.turnUsage?.[slashExtraKey('诈降')],
  },
  {
    // 界武圣(界关羽):你使用的方片【杀】无距离限制。
    // 宽松放行(所有目标可点);后端 杀.validate 按花色严格校验(仅方片杀放行)。
    source: '界武圣',
    kinds: ['attackRange'],
    matches: (players, fromIdx) => !!players[fromIdx]?.skills?.includes('界武圣'),
  },
  {
    // 界烈弓(界黄忠):你【杀】的攻击范围为此杀点数(max(武器范围, 杀点数))。
    // 宽松放行(所有目标可点);后端 distance.ts 的 AttackRangeExemptor 按 cardId 点数
    // 严格校验(仅 effectiveDistance ≤ 杀点数 的目标放行)。
    source: '界烈弓',
    kinds: ['attackRange'],
    matches: (players, fromIdx) => !!players[fromIdx]?.skills?.includes('界烈弓'),
  },
  {
    // 界将驰(界曹彰)选项②:本回合使用【杀】无距离限制。turnUsage 由回合用量 atom 同步;
    // 激活时前端宽松放行(UI 提示),后端 杀.validate 严格校验。
    source: '界将驰',
    kinds: ['attackRange'],
    matches: (players, fromIdx) => !!players[fromIdx]?.turnUsage?.[JIANGCHI_CHOICE2_VIEW_KEY],
  },
  {
    // 界弓骑(界韩当):弃牌后本回合攻击范围无限。turnUsage 由 回合用量 atom 同步;
    // 激活时前端宽松放行(UI 提示),后端 distance.ts inAttackRange 严格校验。
    source: '界弓骑',
    kinds: ['attackRange'],
    matches: (players, fromIdx) => !!players[fromIdx]?.turnUsage?.[GONGQI_ACTIVE_VIEW_KEY],
  },
  {
    // 当先(界廖化):额外出牌阶段获得的该张杀无距离限制。turnUsage 由 回合用量 atom 同步;
    // 激活时前端宽松放行(所有目标可点),后端 distance.ts 的攻击范围豁免器按 cardId
    // 严格校验(仅该张杀放行)。
    source: '界当先',
    kinds: ['attackRange'],
    matches: (players, fromIdx) => !!players[fromIdx]?.turnUsage?.[DANGXIAN_NO_RANGE_VIEW_KEY],
  },
];

/** 是否命中任一通用距离豁免(对应引擎 isDistanceExempted 的 view 投影)。 */
function viewDistanceExempted(
  players: GameView['players'],
  fromIdx: number,
  toIdx: number,
): boolean {
  return VIEW_DISTANCE_EXEMPTIONS.some(
    (e) => e.kinds.includes('distance') && e.matches(players, fromIdx, toIdx),
  );
}

/** 是否命中任一【杀】攻击范围豁免(对应引擎 isAttackRangeExempted 的 view 投影)。 */
function viewAttackRangeExempted(
  players: GameView['players'],
  fromIdx: number,
  toIdx: number,
): boolean {
  return VIEW_DISTANCE_EXEMPTIONS.some(
    (e) => e.kinds.includes('attackRange') && e.matches(players, fromIdx, toIdx),
  );
}

/** GameView 上 from 到 to 的实际距离(含马修正,>= 1) */
export function viewEffectiveDistance(
  players: GameView['players'],
  fromIdx: number,
  toIdx: number,
): number {
  // 豁免器命中视为距离 1(可被所有距离检查放行)。
  if (viewDistanceExempted(players, fromIdx, toIdx)) return 1;
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
  // 与引擎 inAttackRange 同构:攻击范围豁免直接放行;
  // 否则 effectiveDistance(含通用距离豁免)≤ 攻击范围。
  if (viewAttackRangeExempted(players, fromIdx, toIdx)) return true;
  const range = players[fromIdx]?.distanceVars?.attackRange ?? 1;
  return viewEffectiveDistance(players, fromIdx, toIdx) <= range;
}
