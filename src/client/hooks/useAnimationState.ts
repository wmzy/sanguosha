// src/client/hooks/useAnimationState.ts
// 动画状态追踪 hook。检测摸牌、伤害、阶段变化、新回合等事件，
// 触发对应的 UI 动画（通过版本号递增驱动 re-render）。

import { useState, useEffect, useRef } from 'react';
import type { GameView } from '../../engine/types';

/** 体力变化漂浮数字(座位卡/大卡上「-N」红 /「+N」绿) */
export interface HpChangeNumber {
  /** damage=扣减体力(伤害/失去体力),heal=回复体力 */
  kind: 'damage' | 'heal';
  /** 变化量(正数,渲染时按 kind 加符号) */
  amount: number;
  /** 版本号(每次变化递增,React key 变化重放动画;同座位连续变化覆盖显示最新) */
  version: number;
}

export interface AnimationState {
  /** 受到伤害的玩家 index → 动画版本号(每次伤害递增,触发 re-render) */
  damageFlashIndices: Map<number, number>;
  /** 回复体力的玩家 index → 动画版本号(每次回血递增,触发 re-render;桃/桃园结义/急救) */
  healFlashIndices: Map<number, number>;
  /** 体力变化玩家 index → 漂浮数字(与 damageFlash/healFlash 同触发点,动画结束后清除) */
  hpChangeNumbers: Map<number, HpChangeNumber>;
  /** 阶段变化的版本号(触发阶段标签动画) */
  phaseVersion: number;
  /** 新回合的版本号(触发回合光环) */
  turnVersion: number;
  /** 是否触发弃牌阶段动画 */
  discardPhase: boolean;
}

export function useAnimationState(view: GameView, _perspectiveIdx: number): AnimationState {
  const [state, setState] = useState<AnimationState>({
    damageFlashIndices: new Map(),
    healFlashIndices: new Map(),
    hpChangeNumbers: new Map(),
    phaseVersion: 0,
    turnVersion: 0,
    discardPhase: false,
  });

  // 上一次的快照
  const prevHpRef = useRef<Map<number, number>>(new Map());
  const prevPhaseRef = useRef(view.phase);
  const prevRoundRef = useRef(view.turn.round);

  // HP 变化检测:下降=伤害闪烁(红),上升=回血闪烁(绿)。
  // 桃/桃园结义/急救等回复体力时,在目标武将卡上播放回血动画,与伤害对称。
  useEffect(() => {
    const hpMap = new Map(view.players.map((p, i) => [i, p.health]));
    const prevHp = prevHpRef.current;
    // 先收集本帧 HP 变化的座次,再在 setState updater 里读最新 state 计算版本号,
    // 避免闭包基准值(state.damageFlashIndices/healFlashIndices)在连续变化 batching 下读到旧快照。
    const damagedIndices: number[] = [];
    const healedIndices: number[] = [];
    const changeAmounts = new Map<number, number>();
    for (const [i, hp] of hpMap) {
      const prev = prevHp.get(i);
      if (prev === undefined) continue;
      if (hp < prev) {
        damagedIndices.push(i);
        changeAmounts.set(i, prev - hp);
      } else if (hp > prev) {
        healedIndices.push(i);
        changeAmounts.set(i, hp - prev);
      }
    }
    prevHpRef.current = hpMap;
    if (damagedIndices.length === 0 && healedIndices.length === 0) return;

    // 本批次实际写入的漂浮数字快照(updater 执行时填充,供延时清除任务做 version 校验)
    let batchNumbers: Map<number, HpChangeNumber> | null = null;
    setState((s) => {
      const newDamage = new Map<number, number>();
      for (const i of damagedIndices) newDamage.set(i, (s.damageFlashIndices.get(i) ?? 0) + 1);
      const newHeal = new Map<number, number>();
      for (const i of healedIndices) newHeal.set(i, (s.healFlashIndices.get(i) ?? 0) + 1);
      // 漂浮数字复用同一版本号序列;同座位连续变化覆盖为最新(简单方案)
      const newNumbers = new Map<number, HpChangeNumber>();
      for (const [i, amount] of changeAmounts) {
        newNumbers.set(i, {
          kind: healedIndices.includes(i) ? 'heal' : 'damage',
          amount,
          version: newDamage.get(i) ?? newHeal.get(i) ?? 0,
        });
      }
      batchNumbers = newNumbers;
      return {
        ...s,
        damageFlashIndices: new Map([...s.damageFlashIndices, ...newDamage]),
        healFlashIndices: new Map([...s.healFlashIndices, ...newHeal]),
        hpChangeNumbers: new Map([...s.hpChangeNumbers, ...newNumbers]),
      };
    });
    // 闪烁动画结束后清除(0.6s)
    setTimeout(() => {
      setState((s) => {
        const nextDmg = new Map(s.damageFlashIndices);
        for (const i of damagedIndices) nextDmg.delete(i);
        const nextHeal = new Map(s.healFlashIndices);
        for (const i of healedIndices) nextHeal.delete(i);
        return { ...s, damageFlashIndices: nextDmg, healFlashIndices: nextHeal };
      });
    }, 650);
    // 漂浮数字上浮渐隐动画(1s)结束后清除,不残留 DOM/状态。
    // 清除时校验 version:同座位在动画期间再次变化(覆盖显示最新)时,
    // 旧批次的清除任务不得删掉新一轮动画的状态。
    setTimeout(() => {
      const batch = batchNumbers;
      if (!batch) return;
      setState((s) => {
        const next = new Map(s.hpChangeNumbers);
        for (const [i, ch] of batch) {
          if (next.get(i)?.version === ch.version) next.delete(i);
        }
        return { ...s, hpChangeNumbers: next };
      });
    }, 1050);
  }, [view.players]);

  // 阶段变化检测
  useEffect(() => {
    if (view.phase !== prevPhaseRef.current) {
      setState((s) => ({
        ...s,
        phaseVersion: s.phaseVersion + 1,
        discardPhase: view.phase === '弃牌',
      }));
      prevPhaseRef.current = view.phase;
      if (view.phase !== '弃牌') {
        setTimeout(() => setState((s) => ({ ...s, discardPhase: false })), 400);
      }
    }
  }, [view.phase]);

  // 新回合检测
  useEffect(() => {
    if (view.turn.round !== prevRoundRef.current) {
      setState((s) => ({ ...s, turnVersion: s.turnVersion + 1 }));
      prevRoundRef.current = view.turn.round;
    }
  }, [view.turn.round]);

  return state;
}
