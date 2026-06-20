// src/client/hooks/useDebugPerspective.ts
// Debug 模式视角管理 hook。
// 封装原 GameView 内部的「多视角切换」逻辑:自动跟随 pending/选将 target/当前玩家、
// 手动循环切换、代打选将跟随。正式模式不用本 hook(GameView 的 perspective 固定 = viewer)。
//
// 用法(DebugLobby):
//   const { perspective, switchPerspective, goToCurrentPlayer, setPerspective, autoSwitchCtl } = useDebugPerspective(view);
//   <GameViewComponent view={view} perspective={perspective}
//     onSwitchPerspective={switchPerspective} onGoToCurrentPlayer={goToCurrentPlayer}
//     onPerspectiveChange={setPerspective} autoSwitchCtl={autoSwitchCtl} ... />

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameView } from '../../engine/types';

export interface AutoSwitchCtl {
  enabled: boolean;
  toggle: () => void;
}

export interface DebugPerspective {
  /** 当前视角座次 */
  perspective: number;
  /** 循环切到下一视角 */
  switchPerspective: () => void;
  /** 跳到当前回合玩家 */
  goToCurrentPlayer: () => void;
  /** 直接设到指定座次(点座位卡等) */
  setPerspective: (idx: number) => void;
  /** 自动跟随开关 */
  autoSwitchCtl: AutoSwitchCtl;
}

export function useDebugPerspective(view: GameView): DebugPerspective {
  const [perspective, setPerspectiveIdx] = useState(view.viewer);
  const [autoSwitch, setAutoSwitch] = useState(true);
  // 选将期间用户手动切换过视角后,停止自动跟随选将 target
  const charSelectManualSwitchRef = useRef(false);
  const prevCharSelectTargetRef = useRef(-1);
  const pendingRef = useRef(view.pending);
  useEffect(() => { pendingRef.current = view.pending; }, [view.pending]);

  // pending 清空时重置手动切换标记
  useEffect(() => {
    if (!view.pending) {
      charSelectManualSwitchRef.current = false;
      prevCharSelectTargetRef.current = -1;
    }
  }, [view.pending]);

  const charSelectInProgress = view.phase === '准备' && view.players.some(p => !p.character);

  // 自动跟随:有待回应/选将时跟到 target;无 pending 时回当前回合玩家。
  // 选将期间手动切换后停止跟随;charSelectTarget 变化时重置继续跟随。
  // debug 并行选将:viewer 自己选完后 pending 空,但 allCharSelectSlots 有其他玩家 slot →
  //   跟到第一个未选完的玩家(代打),直到用户手动切换。
  useEffect(() => {
    if (!autoSwitch) return;
    const isCharSelect = view.pending?.atom?.type === '选将询问';
    if (isCharSelect) {
      const t = view.pending!.target;
      if (t !== prevCharSelectTargetRef.current) {
        prevCharSelectTargetRef.current = t;
        charSelectManualSwitchRef.current = false;
      }
      if (!charSelectManualSwitchRef.current && t >= 0 && t < view.players.length) {
        setPerspectiveIdx(t);
      }
      return;
    }
    if (charSelectInProgress && view.allCharSelectSlots && view.allCharSelectSlots.length > 0 && !charSelectManualSwitchRef.current) {
      const firstUnselectedSlot = view.allCharSelectSlots.find(s => !view.players[s.target]?.character);
      if (firstUnselectedSlot && firstUnselectedSlot.target >= 0 && firstUnselectedSlot.target < view.players.length) {
        setPerspectiveIdx(firstUnselectedSlot.target);
      }
      return;
    }
    if (view.pending) {
      const targetIdx = view.pending.target;
      if (targetIdx >= 0 && targetIdx < view.players.length) setPerspectiveIdx(targetIdx);
    } else if (!charSelectInProgress) {
      setPerspectiveIdx(view.currentPlayerIndex);
    }
  }, [view.pending?.target, view.currentPlayerIndex, autoSwitch, view.pending?.atom?.type, charSelectInProgress, view.allCharSelectSlots]);

  // 初次加载:默认看自己(选将进行中时由上面的自动切换 effect 接管)
  useEffect(() => { if (!charSelectInProgress) setPerspectiveIdx(view.viewer); }, [view.viewer, charSelectInProgress]);

  const switchPerspective = useCallback(() => {
    const next = (perspective + 1) % view.players.length;
    setPerspectiveIdx(next);
    // 选将期间手动切换后,停止自动跟随
    if (pendingRef.current?.atom?.type === '选将询问') charSelectManualSwitchRef.current = true;
  }, [perspective, view.players.length]);

  const goToCurrentPlayer = useCallback(() => {
    setPerspectiveIdx(view.currentPlayerIndex);
  }, [view.currentPlayerIndex]);

  const setPerspective = useCallback((idx: number) => {
    setPerspectiveIdx(idx);
  }, []);

  return {
    perspective,
    switchPerspective,
    goToCurrentPlayer,
    setPerspective,
    autoSwitchCtl: { enabled: autoSwitch, toggle: useCallback(() => setAutoSwitch(v => !v), []) },
  };
}
