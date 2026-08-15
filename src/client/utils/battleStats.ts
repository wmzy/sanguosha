// 战报统计:从 ViewEvent 事件流累计每座次的 伤害/承伤/击杀/回合数,
// 供 GameResultOverlay 结算面板展示。纯函数 + 一个增量累计 hook。
//
// 事件口径(以 src/engine 实际 toViewEvents 调研为准,不臆造字段):
//   - '扣减体力'   { target, amount }      —— runDamageFlow/runLoseLifeFlow 的实质扣血
//                                            atom,必发事件。承伤按此累计(真实扣血量,
//                                            含失去体力流程的扣减;伤害被防止时无此事件)。
//   - '指定目标'/'成为目标'/'指定目标后' { source, target } —— 必发事件,用于把随后
//     的扣减体力归因到来源座次(伤害时机 atom 带 source 但无 hook 时会被抑制,不可依赖)。
//   - '伤害结算开始时'/'造成伤害时'/'受到伤害时' { source, target, amount } —— 仅在挂
//     了 before-hook(藤甲/奸雄等)时才下发,出现时同样作为归因依据;扣减之后的时机
//     (造成伤害后/伤害结算结束时/伤害结算结束后)不参与归因,避免残留到无关扣减。
//   - '被抵消' { source, target } —— 目标闪避/无懈抵消,清除待归因,防止把之后的
//     自失体力误记到旧攻击者头上。
//   - '回合开始' { player, round } —— turns 计数。
//   - '系统处理牌' { player } —— 阵亡确认(alive=false)。击杀归因到该玩家最近一次
//     已归因的伤害来源(与引擎 state.localVars['死亡/killer'] 的「失去体力无来源」
//     语义对齐:无来源扣减会清除击杀归因)。
//
// 已知近似(可接受,注释说明口径):
//   - 无目标声明的技能直伤(刚烈/反间等)可能漏计输出(无归因来源时只计承伤);
//   - source 为系统来源 TARGET_SYSTEM(-1,闪电等)时不计入任何人的输出。
import { useEffect, useRef, useState } from 'react';
import type { ViewEvent } from '../../engine/types';
import type { QueuedEvent } from '../hooks/useEventPlayback';

/** 单座次战报条目 */
export interface BattleStatEntry {
  /** 输出:归因到该座次的伤害总量 */
  damageDealt: number;
  /** 承伤:该座次扣减体力的总量 */
  damageTaken: number;
  /** 击杀:归因到该座次的击倒数 */
  kills: number;
  /** 回合数:该座次 回合开始 事件次数 */
  turns: number;
}

/** 座次 → 战报条目 */
export type BattleStats = Record<number, BattleStatEntry>;

/** 扣减体力「之前」的伤害时机类型(带 source/target,仅挂 hook 时出现)。
 *  只用这三类武装归因:它们在事件流中紧邻 随后的扣减体力;而 造成伤害后/伤害结算结束(后)
 *  出现在扣减之后,再武装会让归因残留到该目标的下一次无关扣减(如自失体力)。 */
const DAMAGE_PRE_TIMING_TYPES: ReadonlySet<string> = new Set([
  '伤害结算开始时',
  '造成伤害时',
  '受到伤害时',
]);

/** 声明/进入目标关系的事件类型(带 source/target,必发) */
const TARGETING_TYPES: ReadonlySet<string> = new Set([
  '指定目标',
  '成为目标',
  '指定目标后',
]);

/** 战报统计关心的事件(供增量累计时过滤,稀疏于全量事件流,内存可控) */
export function isBattleStatsEvent(event: ViewEvent): boolean {
  const t = event.type;
  return (
    t === '扣减体力' ||
    t === '回合开始' ||
    t === '系统处理牌' ||
    t === '被抵消' ||
    TARGETING_TYPES.has(t) ||
    DAMAGE_PRE_TIMING_TYPES.has(t)
  );
}

/** 安全读取事件数值字段(ViewEvent 索引签名是 unknown) */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 从事件流(按 seq 升序)累计战报。纯函数、无副作用;事件 type 不匹配的条目忽略。
 * 传入乱序/重复事件的统计结果不保证正确,调用方应保证按 seq 升序且无重复。
 */
export function summarizeBattleStats(
  events: ReadonlyArray<{ seq: number; event: ViewEvent }>,
): BattleStats {
  const stats: BattleStats = {};
  const ensure = (seat: number): BattleStatEntry =>
    (stats[seat] ??= { damageDealt: 0, damageTaken: 0, kills: 0, turns: 0 });

  /** target → 待归因伤害来源:由目标声明/伤害时机事件写入,扣减体力时消费(一次性) */
  const pendingSource = new Map<number, number>();
  /** target → 最近一次已归因伤害来源:击杀归因用;无来源扣减时清除(对齐 死亡/killer 语义) */
  const lastHitBy = new Map<number, number>();

  for (const { event } of events) {
    switch (event.type) {
      case '回合开始': {
        const p = num(event.player);
        if (p !== undefined) ensure(p).turns++;
        break;
      }
      case '指定目标':
      case '成为目标':
      case '指定目标后': {
        const s = num(event.source);
        const t = num(event.target);
        if (s !== undefined && t !== undefined) pendingSource.set(t, s);
        break;
      }
      case '被抵消': {
        // 目标抵消了本次牌(闪/无懈):该目标不会因此扣血,清除待归因防误记
        const t = num(event.target);
        if (t !== undefined) pendingSource.delete(t);
        break;
      }
      case '扣减体力': {
        const t = num(event.target);
        const amount = num(event.amount);
        if (t === undefined || amount === undefined) break;
        ensure(t).damageTaken += amount;
        // 消费待归因来源(一次性,防止残留到后续无关扣减)
        const source = pendingSource.get(t);
        pendingSource.delete(t);
        if (source !== undefined && source >= 0) {
          ensure(source).damageDealt += amount;
          lastHitBy.set(t, source);
        } else {
          // 无来源(失去体力/系统伤害如闪电):清除击杀归因,与引擎 killer 语义一致
          lastHitBy.delete(t);
        }
        break;
      }
      case '系统处理牌': {
        // 阵亡确认:击杀归因到致死来源(求桃被救则不会走到这里,归因已随下次伤害更新)
        const p = num(event.player);
        if (p === undefined) break;
        const killer = lastHitBy.get(p);
        if (killer !== undefined) ensure(killer).kills++;
        lastHitBy.delete(p);
        break;
      }
      default: {
        if (DAMAGE_PRE_TIMING_TYPES.has(event.type)) {
          const s = num(event.source);
          const t = num(event.target);
          if (s !== undefined && t !== undefined) pendingSource.set(t, s);
        }
        break;
      }
    }
  }
  return stats;
}

/**
 * 战报事件增量累计 hook。
 *
 * 背景:连接层暴露的 ingestedEvents 是 ~80 条滑动窗口(appendIngestedEvents 会裁掉
 * 旧事件),对局结束时一次性统计会丢掉早期伤害/回合。此 hook 按 seq 单调性增量提取
 * 窗口中的战报相关事件(每个事件在滑出窗口前恰好计一次),返回累计结果。
 *
 * @param ingested 滑动窗口事件流(useMultiplayerRoom / useDebugMultiConnection 的 ingestedEvents)
 * @param active   本局是否进行中/已结束;为 false 时清空累计(用于 game_reset 后新一局,
 *                 多人模式传 stage 为 playing/spectating/ended,debug 模式传 gameStarted)
 */
export function useBattleStatsEvents(
  ingested: readonly QueuedEvent[],
  active: boolean,
): QueuedEvent[] {
  const [events, setEvents] = useState<QueuedEvent[]>([]);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!active) {
      // 一局结束重置(game_reset 后 seq 从 1 重新计数):清空累计
      if (seqRef.current !== 0) {
        seqRef.current = 0;
        setEvents([]);
      }
      return;
    }
    const fresh = ingested.filter(
      (e) => e.seq > seqRef.current && isBattleStatsEvent(e.event),
    );
    if (fresh.length === 0) return;
    seqRef.current = fresh[fresh.length - 1].seq;
    setEvents((prev) => [...prev, ...fresh]);
  }, [ingested, active]);

  return events;
}
