// src/client/utils/viewMaintenance.ts
// 实时连接(headless/viewMaintainer)与录像回放(replay/replayEngine)共用的
// GameView 维护原语:pendingResolved 清除判定 / deadline 同步 / viewReducer
// 突变前的防御性拷贝。两条链路各自维护 view 快照,但对 pending/deadline 的
// 口径必须一致、对 viewReducer 原地突变的隔离需求相同,故收敛于此。

import type { GameView } from '../../engine/types';

/** pendingResolved 通知是否应清除当前 view 的 pending(宽松口径,取回放端完整版):
 *  - target < 0:系统/广播清除;
 *  - target === viewer:本连接视角自己的 slot 已解决(前端座次逻辑);
 *  - pending?.target === target:slot 精确匹配(harness 逻辑)。
 *  任一满足即清。实时端此前只判第 1/3 条,与回放端口径不一致;实时端的
 *  view.pending 只投影本 viewer 的 slot(target 只会是 viewer 或广播 -1),
 *  补上 target===viewer 不会误清他人 pending。 */
export function shouldClearPending(
  pending: GameView['pending'],
  target: number,
  viewer: number,
): boolean {
  return target < 0 || target === viewer || pending?.target === target;
}

/** 把 view 的 deadline/deadlineTotalMs 同步为 pending 快照(或 DeadlineInfo)携带的值;
 *  source 为 null/undefined 时清零(deadline=null, totalMs=0),与 pending 清除路径同口径。
 *  实时端与回放端在「pending 变化 → deadline 跟随」「pending 清除 → deadline 清零」
 *  两条路径上重复此三元赋值,收敛于此。原地写 view,调用方负责传入可突变的副本。 */
export function syncDeadline(
  view: GameView,
  source: { deadline?: number; totalMs?: number } | null | undefined,
): void {
  view.deadline = source?.deadline ?? null;
  view.deadlineTotalMs = source?.totalMs ?? 0;
}

/** viewReducer(applyView)原地突变前的防御性拷贝:复制所有会被原地突变的字段,
 *  返回独立副本,避免 prev/next 共享引用。共享引用的两类危害:
 *  1. memo 冻结——playerVisibleEqual/ZoneInfoBar/GameLog 等比较器对同一引用
 *     永远判等,突变写回旧值导致座位卡/弃牌堆/日志面板显示冻结;
 *  2. 基线污染——回放端每次重放共用录像原始 baseline,突变会跨重放累积。
 *  覆盖面(viewReducer/applyView 的全部原地突变点):
 *  - players 各数组字段(hand/marks/skills/tags/pendingTricks)会被 push/splice,
 *    equipment/distanceVars/turnUsage 对象会被写字段;
 *  - zones.processing / log 会被 push/filter;
 *  - settlementStack 会被 push/pop,帧的 params/cards 被原地写;
 *  - cardMap 会被 当作(影子卡)写入新键;
 *  - turn.vars 会被 回合结束 重置。
 *  手写浅拷贝+嵌套拷贝而非 JSON 深拷贝:性能更好,且 JSON 会丢弃值为 undefined
 *  的字段(如 hand: undefined)。Card/Mark/log 条目等叶子对象从不被原地突变,
 *  保持共享即可;pending 只被整体替换(applyView 从不原地改它),同样保持共享
 *  以免 memo 误判每次事件都变化。 */
export function cloneViewForMutation(view: GameView): GameView {
  return {
    ...view,
    turn: { ...view.turn, vars: { ...view.turn.vars } },
    players: view.players.map((p) => ({
      ...p,
      hand: p.hand ? [...p.hand] : p.hand,
      skills: [...(p.skills ?? [])],
      marks: [...(p.marks ?? [])],
      tags: [...(p.tags ?? [])],
      equipment: { ...(p.equipment ?? {}) },
      pendingTricks: [...(p.pendingTricks ?? [])],
      distanceVars: p.distanceVars ? { ...p.distanceVars } : p.distanceVars,
      turnUsage: p.turnUsage ? { ...p.turnUsage } : p.turnUsage,
    })),
    cardMap: { ...view.cardMap },
    settlementStack: view.settlementStack.map((f) => ({
      ...f,
      params: { ...f.params },
      cards: [...f.cards],
    })),
    zones: view.zones
      ? { ...view.zones, processing: [...(view.zones.processing ?? [])] }
      : view.zones,
    log: [...view.log],
  };
}
