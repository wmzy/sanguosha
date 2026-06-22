// src/client/hooks/useDebugPerspective.ts
// Debug 模式视角管理 hook(多 WS 版)。
//
// 多 WS 模型:每个座次是独立连接,views: Map<viewer, GameView>。
// perspective 由 DebugLobby 持有,本 hook 接收当前 perspective 对应的 currentView,
// 提供切换/自动跟随逻辑。
//
// 自动跟随:基于 currentPlayerIndex(所有 view 共有的公开信息)。
//   有 pending 时跟随到 pending.target;无 pending 时回当前回合玩家。
//
// 稳定性关键:effect 不直接依赖 perspective(否则 setPerspective→perspective 变→
// effect 重跑→死循环)。用 ref 读 perspective 做判断。

import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameView } from '../../engine/types';

export interface AutoSwitchCtl {
  enabled: boolean;
  toggle: () => void;
}

export interface DebugPerspective {
  switchPerspective: () => void;
  goToCurrentPlayer: () => void;
  autoSwitchCtl: AutoSwitchCtl;
}

export function useDebugPerspective(
  currentView: GameView | null,
  perspective: number,
  playerCount: number,
  setPerspective: (idx: number) => void,
): DebugPerspective {
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [manualOverride, setManualOverride] = useState(false);
  // ref 读 perspective,避免 effect 依赖它导致循环
  const perspectiveRef = useRef(perspective);
  perspectiveRef.current = perspective;

  // pending 清空时重置手动标记
  useEffect(() => {
    if (!currentView?.pending) {
      setManualOverride(false);
    }
  }, [currentView?.pending]);

  // 自动跟随:只依赖 currentView 的派生值,不依赖 perspective
  const pendingTarget = currentView?.pending?.target;
  const currentPlayer = currentView?.currentPlayerIndex;
  const hasPending = !!currentView?.pending;
  useEffect(() => {
    if (!autoSwitch || !currentView || manualOverride) return;
    const p = perspectiveRef.current;
    if (typeof pendingTarget === 'number' && pendingTarget >= 0 && pendingTarget !== p) {
      setPerspective(pendingTarget);
    } else if (!hasPending && typeof currentPlayer === 'number' && currentPlayer !== p) {
      setPerspective(currentPlayer);
    }
    // 刻意不把 perspective/setPerspective 放进依赖:用 ref 读避免循环
  }, [pendingTarget, currentPlayer, hasPending, autoSwitch, manualOverride, currentView, setPerspective]);

  const switchPerspective = useCallback(() => {
    setManualOverride(true);
    setPerspective((perspective + 1) % playerCount);
  }, [perspective, playerCount, setPerspective]);

  const goToCurrentPlayer = useCallback(() => {
    setManualOverride(true);
    if (currentView) setPerspective(currentView.currentPlayerIndex);
  }, [currentView, setPerspective]);

  const toggle = useCallback(() => setAutoSwitch(a => !a), []);

  return {
    switchPerspective,
    goToCurrentPlayer,
    autoSwitchCtl: { enabled: autoSwitch, toggle },
  };
}
