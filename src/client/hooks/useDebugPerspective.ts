// src/client/hooks/useDebugPerspective.ts
// Debug 模式视角管理 hook(多 WS 版)。
//
// 多 WS 模型:每个座次是独立连接,views: Map<viewer, GameView>。
// perspective 由 DebugLobby 持有,本 hook 接收所有座次的 views,
// 提供切换/自动跟随逻辑。
//
// 自动跟随:选将阶段扫描所有 views,找下一个有待选将 pending 或尚未选完的座次;
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

/**
 * 选将阶段:某座次是否"正在等待选将"(该连接的玩家还没选完)。
 * 与 isCharSelectPendingForView 的区别:后者要求 view.pending 非空(引擎已建立 slot)。
 * 本函数也覆盖"pending 事件还没到达客户端"的时间窗口:
 * phase=准备 + 该座次玩家还没选 + 无 pending → 正在等引擎分配 slot。
 */
function isWaitingToSelect(view: GameView | null | undefined, viewerIdx: number): boolean {
  if (!view) return false;
  if (view.phase !== '准备') return false;
  const player = view.players[viewerIdx];
  return !!player && !player.character;
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

  // 选将阶段结束后(所有玩家已选完且不在准备阶段)重置手动标记
  useEffect(() => {
    if (!isCharSelectPhase(currentView)) {
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

    // 选将阶段:扫描找下一个有待选将 pending 或等待选将的座次
    if (charSelectInProgress) {
      // 当前视角自己有选将 pending → 保持(正在选)
      if (isCharSelectPendingForView(currentView)) return;
      // 当前视角玩家还没选完(没有 pending 但也没 character) → 保持(等 slot 建立)
      if (isWaitingToSelect(currentView, p)) return;
      // 扫描其他座次,找第一个有待选将 pending 或等待选将的
      for (let i = 1; i <= playerCount; i++) {
        const idx = (p + i) % playerCount;
        const v = allViews.get(idx);
        if (isCharSelectPendingForView(v) || isWaitingToSelect(v, idx)) {
          setPerspective(idx);
          return;
        }
      }
      // 所有座次都已选完(视角数据还没更新到选将结束) → 保持
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
    const p = perspectiveRef.current;
    if (charSelectInProgress) {
      // 从 p+1 开始找下一个待选将座次
      for (let i = 1; i <= playerCount; i++) {
        const idx = (p + i) % playerCount;
        const v = allViews.get(idx);
        if (isCharSelectPendingForView(v) || isWaitingToSelect(v, idx)) {
          setPerspective(idx);
          return;
        }
      }
      // 没找到 → 回主公
      setPerspective(0);
      return;
    }
    setPerspective((p + 1) % playerCount);
  }, [playerCount, setPerspective, allViews, charSelectInProgress]);

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
