// src/client/hooks/useDebugPerspective.ts
// Debug 模式视角管理 hook(多 WS 版)。
//
// 多 WS 模型:每个座次是独立连接,views: Map<viewer, GameView>。
// perspective 由 DebugLobby 持有,本 hook 接收所有座次的 views,
// 提供切换/自动跟随逻辑。
//
// 自动跟随:选将阶段优先扫描所有 views 找下一个有待选将 pending 的座次;
// 非选将阶段(出牌/弃牌)跟随 currentPlayerIndex。
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

/** 检查某座次的 view 是否处于选将 pending(需选将且未选完) */
function isCharSelectPendingForView(view: GameView | null | undefined): boolean {
  if (!view?.pending) return false;
  if (view.pending.atom?.type !== '选将询问') return false;
  const target = view.pending.target;
  return !view.players[target]?.character;
}

/** 检查某座次的 view 是否处于选将阶段(有玩家未选完) */
function isCharSelectPhase(view: GameView | null | undefined): boolean {
  return view?.phase === '准备' && view.players.some(p => !p.character);
}

export function useDebugPerspective(
  allViews: Map<number, GameView>,
  perspective: number,
  playerCount: number,
  setPerspective: (idx: number) => void,
): DebugPerspective {
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [manualOverride, setManualOverride] = useState(false);
  // ref 读 perspective,避免 effect 依赖它导致循环
  const perspectiveRef = useRef(perspective);
  perspectiveRef.current = perspective;

  const currentView = allViews.get(perspective) ?? null;

  // pending 清空且不在选将阶段时重置手动标记
  useEffect(() => {
    if (!currentView?.pending && !isCharSelectPhase(currentView)) {
      setManualOverride(false);
    }
  }, [currentView]);

  // 自动跟随:扫描所有 views,选将阶段优先找下一个待选将座次
  const charSelectInProgress = isCharSelectPhase(currentView);
  const currentPlayer = currentView?.currentPlayerIndex;
  const currentViewPendingTarget = currentView?.pending?.target;

  useEffect(() => {
    if (!autoSwitch || !currentView || manualOverride) return;
    const p = perspectiveRef.current;

    // 选将阶段:优先扫描找下一个有选将 pending 的座次
    if (charSelectInProgress) {
      // 当前视角自己有选将 pending → 保持
      if (isCharSelectPendingForView(currentView)) return;
      // 扫描其他座次,找第一个有待选将 pending 的
      for (let i = 0; i < playerCount; i++) {
        const v = allViews.get(i);
        if (isCharSelectPendingForView(v) && i !== p) {
          setPerspective(i);
          return;
        }
      }
      // 没找到待选将座次,但选将仍在进行(可能在过渡中)→ 保持当前
      return;
    }

    // 非选将阶段:跟随 currentPlayer(出牌/弃牌 pending)
    if (typeof currentViewPendingTarget === 'number' && currentViewPendingTarget >= 0 && currentViewPendingTarget !== p) {
      setPerspective(currentViewPendingTarget);
    } else if (typeof currentPlayer === 'number' && currentPlayer !== p) {
      setPerspective(currentPlayer);
    }
    // 刻意不把 perspective/setPerspective 放进依赖:用 ref 读避免循环
  }, [charSelectInProgress, currentViewPendingTarget, currentPlayer, autoSwitch, manualOverride, currentView, allViews, playerCount, setPerspective]);

  /** 切换视角:选将阶段切到下一个待选将座次,否则简单 +1 */
  const switchPerspective = useCallback(() => {
    setManualOverride(true);
    if (charSelectInProgress) {
      // 找下一个待选将座次
      for (let i = 1; i <= playerCount; i++) {
        const idx = (perspective + i) % playerCount;
        const v = allViews.get(idx);
        if (isCharSelectPendingForView(v)) {
          setPerspective(idx);
          return;
        }
      }
      // 没找到待选将座次 → 回主公
      setPerspective(0);
      return;
    }
    setPerspective((perspective + 1) % playerCount);
  }, [perspective, playerCount, setPerspective, allViews, charSelectInProgress]);

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
