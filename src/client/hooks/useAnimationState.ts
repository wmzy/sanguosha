// src/client/hooks/useAnimationState.ts
// 动画状态追踪 hook。检测摸牌、伤害、阶段变化、新回合等事件，
// 触发对应的 UI 动画（通过版本号递增驱动 re-render）。

import { useState, useEffect, useRef } from 'react';
import type { GameView } from '../../engine/types';

export interface AnimationState {
  /** 当前需要播放摸牌动画的卡牌 ID 集合 */
  newCardIds: Set<string>;
  /** 受到伤害的玩家 index → 动画版本号(每次伤害递增,触发 re-render) */
  damageFlashIndices: Map<number, number>;
  /** 阶段变化的版本号(触发阶段标签动画) */
  phaseVersion: number;
  /** 新回合的版本号(触发回合光环) */
  turnVersion: number;
  /** 是否触发弃牌阶段动画 */
  discardPhase: boolean;
}

export function useAnimationState(view: GameView, perspectiveIdx: number): AnimationState {
  const [state, setState] = useState<AnimationState>({
    newCardIds: new Set(),
    damageFlashIndices: new Map(),
    phaseVersion: 0,
    turnVersion: 0,
    discardPhase: false,
  });

  // 上一次的快照
  const prevHandRef = useRef<string[]>([]);
  const prevHpRef = useRef<Map<number, number>>(new Map());
  const prevPhaseRef = useRef(view.phase);
  const prevRoundRef = useRef(view.turn.round);

  // 摸牌检测:当前视角手牌 ID 相对上一次新增的
  useEffect(() => {
    const hand = view.players[perspectiveIdx]?.hand ?? [];
    const handIds = hand.map((c) => c.id);
    const prevIds = prevHandRef.current;
    const newIds = handIds.filter((id) => !prevIds.includes(id));
    if (newIds.length > 0) {
      setState((s) => ({ ...s, newCardIds: new Set([...s.newCardIds, ...newIds]) }));
      // 动画结束后清除标记(0.5s 留余量)
      setTimeout(() => {
        setState((s) => {
          const next = new Set(s.newCardIds);
          for (const id of newIds) next.delete(id);
          return { ...s, newCardIds: next };
        });
      }, 550);
    }
    prevHandRef.current = handIds;
  }, [view.players[perspectiveIdx]?.hand]);

  // 伤害检测:任意玩家 HP 下降
  useEffect(() => {
    const hpMap = new Map(view.players.map((p, i) => [i, p.health]));
    const prevHp = prevHpRef.current;
    // 先收集本帧 HP 下降的座次,再在 setState updater 里读最新 state 计算版本号,
    // 避免闭包基准值(state.damageFlashIndices)在连续伤害 batching 下读到旧快照。
    const damagedIndices: number[] = [];
    for (const [i, hp] of hpMap) {
      const prev = prevHp.get(i);
      if (prev !== undefined && hp < prev) {
        damagedIndices.push(i);
      }
    }
    if (damagedIndices.length > 0) {
      setState((s) => {
        const newFlash = new Map<number, number>();
        for (const i of damagedIndices) {
          newFlash.set(i, (s.damageFlashIndices.get(i) ?? 0) + 1);
        }
        return { ...s, damageFlashIndices: new Map([...s.damageFlashIndices, ...newFlash]) };
      });
      // 动画结束后清除(0.6s)
      setTimeout(() => {
        setState((s) => {
          const next = new Map(s.damageFlashIndices);
          for (const i of damagedIndices) next.delete(i);
          return { ...s, damageFlashIndices: next };
        });
      }, 650);
    }
    prevHpRef.current = hpMap;
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
