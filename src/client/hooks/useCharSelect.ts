// src/client/hooks/useCharSelect.ts
// 选将状态推导 hook。从 GameView.tsx 提取。
//
// 每个 WS 连接(viewer)只看到自己的 view.pending。debug 模式下上层把 perspective
// 切到目标座次的连接即可看到其 pending,不需要从 view 跨连接读其他玩家的 slot。

import type { GameView, PendingView } from '../../engine/types';
import { useSubmittedCharSelects } from './SubmittedCharSelectCtx';

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
  /** 选将 slot(当前视角连接的 pending) */
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
  const submittedCharSelects = useSubmittedCharSelects();
  const charSelectPending = view.pending?.atom?.type === '选将询问'
    && !view.players[view.pending.target].character
    && !submittedCharSelects.has(view.pending.target)
    ? view.pending : null;

  const isCharSelectPending = charSelectPending !== null;
  const candidates: Array<{ name: string; skills: string[] }> = charSelectPending
    ? ((charSelectPending.atom as unknown as CharSelectAtom).candidates ?? [])
    : [];
  const charSelectTarget = charSelectPending ? charSelectPending.target : -1;

  const charSelect: CharSelectSlot | null = isCharSelectPending
    ? { candidates, target: charSelectTarget, pending: charSelectPending }
    : null;

  const charSelectInProgress = view.phase === '准备' && view.players.some(p => !p.character);
  const perspectiveCharSelected = !!view.players[perspectiveIdx].character;

  return { isCharSelectPending, charSelect, charSelectInProgress, perspectiveCharSelected };
}
