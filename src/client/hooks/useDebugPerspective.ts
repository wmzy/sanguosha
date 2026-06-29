// src/client/hooks/useDebugPerspective.ts
// Debug 模式视角管理 hook(多 WS 版)。
//
// 多 WS 模型:每个座次是独立连接,views: Map<viewer, GameView>。
// perspective 由 DebugLobby 持有,本 hook 接收所有座次的 views,提供自动跟随 + 手动切换。
//
// 自动跟随原则:
//   选将阶段:跟随第一个还没选完武将的座次(详见 hasCharSelectPending/isWaitingToSelect)。
//     hasCharSelectPending 只看引擎真实状态(该 target 是否已选完),不看乐观提交集合,
//     否则在「最后一人 pending 还在、但已被乐观标记」的竞态下会被拉走 → 最后一人选不了。
//   非选将阶段:当前座次自己有专属阻塞 pending(被问询)→ 保持;
//     否则跟到第一个被问询的玩家(请求闪等切到被问询者),都不需要操作时跟随 currentPlayer。
//
// 用户可随时手动切换(切换后本次不触发自动跟随,等下一次状态变化再恢复)。

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

/** 检查某座次的 view 是否有活跃的选将 pending(需选将且未选完)。
 *  注意:只看引擎真实状态(view.players[target].character),不看乐观提交集合。 */
function hasCharSelectPending(view: GameView | null | undefined): boolean {
  if (!view?.pending) return false;
  if (view.pending.atom?.type !== '选将询问') return false;
  const target = view.pending.target;
  return !view.players[target].character;
}

/** 检查某座次的 view 是否处于选将阶段(有玩家未选完) */
function isCharSelectPhase(view: GameView | null | undefined): boolean {
  return view?.phase === '准备' && view.players.some((p) => !p.character);
}

/**
 * 选将阶段:某座次是否"正在等待选该玩家的将"(该连接的玩家还没选完)。
 * 覆盖两种情况:
 *   1. view.pending 非空(引擎已建立选将 slot)
 *   2. view.pending 为空但 phase=准备 且该座次玩家还没选(事件还没到达客户端)
 */
function isWaitingToSelect(
  view: GameView | null | undefined,
  viewerIdx: number,
  submitted?: Set<number>,
): boolean {
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

/** 非选将阶段:某座次是否有「自己专属」阻塞型 pending(被问询/需弃牌等)。
 *  严格用 target===viewer 判断,观察型 pending(target!==viewer)不算,避免死循环。 */
function hasOwnBlockingPending(view: GameView | null | undefined, viewerIdx: number): boolean {
  const pending = view?.pending;
  return !!pending && pending.isBlocking !== false && pending.target === viewerIdx;
}

export function useDebugPerspective(
  allViews: Map<number, GameView>,
  perspective: number,
  playerCount: number,
  setPerspective: (idx: number) => void,
): DebugPerspective {
  const [autoSwitch, setAutoSwitch] = useState(true);
  const submitted = useSubmittedCharSelects();
  // 选将阶段结束后重置的标记:控制非选将阶段是否跟随 currentPlayer
  const [followCurrentPlayer, setFollowCurrentPlayer] = useState(false);
  const perspectiveRef = useRef(perspective);
  perspectiveRef.current = perspective;
  // 手动切视角标记:阻止自动跟随在手动切换后立即覆盖。effect 消费后重置。
  const manualSwitchRef = useRef(false);

  // 包装 setPerspective:手动切换时设标记,阻止自动跟随覆盖
  const manualSetPerspective = useCallback(
    (idx: number) => {
      manualSwitchRef.current = true;
      setPerspective(idx);
    },
    [setPerspective],
  );

  const currentView = allViews.get(perspective) ?? null;

  // 选将阶段结束后,启用常规跟随(currentPlayer)
  useEffect(() => {
    if (!isCharSelectPhase(currentView)) {
      setFollowCurrentPlayer(true);
    }
  }, [currentView]);

  // 自动跟随
  const charSelectInProgress = isCharSelectPhase(currentView);
  const currentPlayer = currentView?.currentPlayerIndex;

  useEffect(() => {
    if (!autoSwitch || !currentView) return;
    // 手动切换后本次跳过(消费标记)
    if (manualSwitchRef.current) {
      manualSwitchRef.current = false;
      return;
    }
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
    // 当前座次自己有专属阻塞 pending(被问询)→ 保持。
    // 否则跟到第一个被问询的玩家(请求闪等切到被问询者,而非停在出杀的 currentPlayer);
    // 都不需要操作时跟随 currentPlayer。
    if (hasOwnBlockingPending(currentView, p)) return;
    for (let i = 0; i < playerCount; i++) {
      const v = allViews.get(i);
      if (i !== p && hasOwnBlockingPending(v, i)) {
        setPerspective(i);
        return;
      }
    }
    if (followCurrentPlayer && typeof currentPlayer === 'number' && currentPlayer !== p) {
      setPerspective(currentPlayer);
    }
  }, [
    charSelectInProgress,
    currentPlayer,
    autoSwitch,
    followCurrentPlayer,
    currentView,
    allViews,
    playerCount,
    setPerspective,
    submitted,
  ]);

  /** 手动切换:+1 循环,选将阶段也允许切到任意座次(debug 需要查看所有人) */
  const switchPerspective = useCallback(() => {
    const p = perspectiveRef.current;
    manualSetPerspective((p + 1) % playerCount);
  }, [playerCount, manualSetPerspective]);

  /** 切到下一个未选将座次(选将等待蒙层用:文字和行为一致) */
  const switchToNextUnselected = useCallback(() => {
    const p = perspectiveRef.current;
    const next = findNextSelectTarget(allViews, playerCount, p, submitted);
    manualSetPerspective(next >= 0 ? next : (p + 1) % playerCount);
  }, [playerCount, manualSetPerspective, allViews, submitted]);

  const goToCurrentPlayer = useCallback(() => {
    if (currentView) manualSetPerspective(currentView.currentPlayerIndex);
  }, [currentView, manualSetPerspective]);

  const toggle = useCallback(() => setAutoSwitch((a) => !a), []);

  return {
    switchPerspective,
    switchToNextUnselected,
    goToCurrentPlayer,
    autoSwitchCtl: { enabled: autoSwitch, toggle },
  };
}
