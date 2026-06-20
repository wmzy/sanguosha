// src/client/hooks/useCharSelect.ts
// 选将状态推导 hook。从 GameView.tsx 提取。
//
// 正式模式:view.pending 是自己的选将询问(viewer 隔离)。
// debug 模式:上层已将 perspective 切到待选将玩家,从 allCharSelectSlots 取该玩家的 slot
//   (viewer 自己选完时 view.pending 为空,靠 allCharSelectSlots 代打其他玩家)。

import type { GameView, PendingView } from '../../engine/types';

export interface CharSelectSlot {
  /** 候选武将 */
  candidates: Array<{ name: string; skills: string[] }>;
  /** 选将 target 座次 */
  target: number;
  /** 原 pending(取 deadline/totalMs) */
  pending: PendingView | null;
}

export interface CharSelectState {
  /** 当前是否有选将待处理 */
  isCharSelectPending: boolean;
  /** 选将 slot(own + parallel 二选一) */
  charSelect: CharSelectSlot | null;
  /** 选将阶段是否仍在进行(有玩家未选完) */
  charSelectInProgress: boolean;
  /** 当前视角玩家是否已选将 */
  perspectiveCharSelected: boolean;
}

interface CharSelectAtom {
  candidates: Array<{ name: string; skills: string[] }>;
}

/**
 * 推导选将相关状态。
 * @param view           引擎视图
 * @param perspectiveIdx 当前视角座次
 */
export function useCharSelect(view: GameView, perspectiveIdx: number): CharSelectState {
  const ownCharSelect = view.pending?.atom?.type === '选将询问' ? view.pending : null;
  const parallelSlot = view.allCharSelectSlots?.find(
    s => s.atom.type === '选将询问' && s.target === perspectiveIdx,
  ) ?? null;
  const charSelectPending = ownCharSelect ?? parallelSlot;

  const isCharSelectPending = charSelectPending !== null;
  const candidates: Array<{ name: string; skills: string[] }> = charSelectPending
    ? ((charSelectPending.atom as unknown as CharSelectAtom).candidates ?? [])
    : [];
  const charSelectTarget = charSelectPending ? charSelectPending.target : -1;

  const charSelect: CharSelectSlot | null = isCharSelectPending
    ? { candidates, target: charSelectTarget, pending: charSelectPending }
    : null;

  const charSelectInProgress = view.phase === '准备' && view.players.some(p => !p.character);
  const perspectiveCharSelected = !!view.players[perspectiveIdx]?.character;

  return { isCharSelectPending, charSelect, charSelectInProgress, perspectiveCharSelected };
}
