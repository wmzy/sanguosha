// src/client/hooks/useDebugPerspective.ts
// Debug 模式视角管理 hook(多 WS 版)。
//
// 多 WS 模型:每个座次是独立连接,views: Map<viewer, GameView>。
// perspective 由 DebugLobby 持有,本 hook 接收所有座次的 views,
// 提供切换/自动跟随逻辑。
//
// 自动跟随:选将阶段始终扫描所有 views,找到下一个待选将座次自动切过去。
// 用户可随时手动切到任意座次查看,auto-switch 只在"下一个待选将座次"变化时触发。
//
// 稳定性关键:effect 不直接依赖 perspective(否则 setPerspective→perspective 变→
// effect 重跑→死循环)。用 ref 读 perspective 做判断。

import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameView } from '../../engine/types';
import { useSubmittedCharSelects } from './SubmittedCharSelectCtx';

export interface AutoSwitchCtl {
  enabled: boolean;
  toggle: () => void;
}

export interface DebugPerspective {
  /** 手动切换:始终 +1 循环,任意座次 */
  switchPerspective: () => void;
  /** 切到下一个未选将座次(选将等待蒙层用) */
  switchToNextUnselected: () => void;
  goToCurrentPlayer: () => void;
  autoSwitchCtl: AutoSwitchCtl;
}

/** 检查某座次的 view 是否有活跃的选将 pending(需选将且未选完) */
function hasCharSelectPending(view: GameView | null | undefined): boolean {
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
 * 选将阶段:某座次是否"正在等待选该玩家的将"(该连接的玩家还没选完)。
 * 覆盖两种情况:
 *   1. view.pending 非空(引擎已建立选将 slot)
 *   2. view.pending 为空但 phase=准备 且该座次玩家还没选(事件还没到达客户端)
 */
function isWaitingToSelect(view: GameView | null | undefined, viewerIdx: number, submitted?: Set<number>): boolean {
  if (!view) return false;
  if (view.phase !== '准备') return false;
  if (submitted?.has(viewerIdx)) return false; // 已提交选将
  const player = view.players[viewerIdx];
  return !!player && !player.character;
}

/**
 * 扫描所有 views,找到下一个有选将 pending 或等待选将的座次。
 * 从 fromIdx+1 开始循环扫描,跳过 fromIdx 自身。
 * 返回 -1 表示没有找到(所有玩家已选完)。
 */
function findNextSelectTarget(
  allViews: Map<number, GameView>,
  playerCount: number,
  fromIdx: number,
  submitted?: Set<number>,
): number {
  for (let i = 1; i <= playerCount; i++) {
    const idx = (fromIdx + i) % playerCount;
    const v = allViews.get(idx);
    if (hasCharSelectPending(v) || isWaitingToSelect(v, idx, submitted)) {
      return idx;
    }
  }
  return -1;
}

export function useDebugPerspective(
  allViews: Map<number, GameView>,
  perspective: number,
  playerCount: number,
  setPerspective: (idx: number) => void,
): DebugPerspective {
  const [autoSwitch, setAutoSwitch] = useState(true);
  const submitted = useSubmittedCharSelects();
  // 选将阶段结束后重置的标记(非选将阶段 auto-switch 跟随 currentPlayerIndex)
  const [followCurrentPlayer, setFollowCurrentPlayer] = useState(false);
  const perspectiveRef = useRef(perspective);
  perspectiveRef.current = perspective;

  const currentView = allViews.get(perspective) ?? null;

  // 选将阶段结束后,切到 currentPlayerIndex 并启用常规跟随
  useEffect(() => {
    if (!isCharSelectPhase(currentView)) {
      setFollowCurrentPlayer(true);
    }
  }, [currentView]);

  // 自动跟随
  const charSelectInProgress = isCharSelectPhase(currentView);
  const currentPlayer = currentView?.currentPlayerIndex;
  const currentViewPendingTarget = currentView?.pending?.target;

  useEffect(() => {
    if (!autoSwitch || !currentView) return;
    const p = perspectiveRef.current;

    if (charSelectInProgress) {
      // ── 选将阶段 ──
      // 当前视角有活跃选将 pending → 保持(正在选)
      if (hasCharSelectPending(currentView)) return;
      // 当前视角正在等选将(没有 pending 但还没选完) → 保持
      if (isWaitingToSelect(currentView, p, submitted)) return;
      // 当前视角已选完 → 找下一个待选将座次,切过去
      const next = findNextSelectTarget(allViews, playerCount, p, submitted);
      if (next >= 0 && next !== p) {
        setPerspective(next);
      }
      return;
    }

    // ── 非选将阶段(出牌/弃牌) ──
    if (followCurrentPlayer || !currentView.pending) {
      if (typeof currentViewPendingTarget === 'number' && currentViewPendingTarget >= 0 && currentViewPendingTarget !== p) {
        setPerspective(currentViewPendingTarget);
      } else if (typeof currentPlayer === 'number' && currentPlayer !== p) {
        setPerspective(currentPlayer);
      }
    }
  }, [charSelectInProgress, currentViewPendingTarget, currentPlayer, autoSwitch,
    followCurrentPlayer, currentView, allViews, playerCount, setPerspective]);

  /** 手动切换:始终 +1 循环,选将阶段也允许切到任意座次(debug 需要查看所有人) */
  const switchPerspective = useCallback(() => {
    const p = perspectiveRef.current;
    setPerspective((p + 1) % playerCount);
  }, [playerCount, setPerspective]);

  /** 切到下一个未选将座次(选将等待蒙层用:文字和行为一致) */
  const switchToNextUnselected = useCallback(() => {
    const p = perspectiveRef.current;
    const next = findNextSelectTarget(allViews, playerCount, p, submitted);
    setPerspective(next >= 0 ? next : (p + 1) % playerCount);
  }, [playerCount, setPerspective, allViews, submitted]);

  const goToCurrentPlayer = useCallback(() => {
    if (currentView) setPerspective(currentView.currentPlayerIndex);
  }, [currentView, setPerspective]);

  const toggle = useCallback(() => setAutoSwitch(a => !a), []);

  return {
    switchPerspective,
    switchToNextUnselected,
    goToCurrentPlayer,
    autoSwitchCtl: { enabled: autoSwitch, toggle },
  };
}
