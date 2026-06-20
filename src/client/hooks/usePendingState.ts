// src/client/hooks/usePendingState.ts
// pending(待回应)状态派生 hook。从 GameView.tsx 提取。
//
// 从 view.pending 推导出前端需要的派生量:
//   isPerspectiveAwaiting — 当前视角是否在等待回应
//   isDiscardPhase / discardMin / discardMax — 弃牌窗口
//   skippedBroadcast — 广播型 pending 的本地跳过标记(无懈可击等)
//   deadline — 倒计时基准
// pending 变化时自动重置 skippedBroadcast 和弃牌选中。

import { useState, useEffect, useMemo } from 'react';
import type { GameView, PendingView } from '../../engine/types';

export interface PendingState {
  /** 原始 pending(可能 null) */
  pending: PendingView | null;
  /** pending 的 target 座次;无 pending 时为 -1 */
  pendingTargetIdx: number;
  /** 当前视角是否在等待回应(广播型 target<0 也算) */
  isPerspectiveAwaiting: boolean;
  /** 是否为弃牌窗口(requestType === '__弃牌') */
  isDiscardPhase: boolean;
  /** 弃牌窗口的最少/最多张数 */
  discardMin: number;
  discardMax: number;
  /** 广播型 pending 的本地跳过标记集合 */
  skippedBroadcast: Set<string>;
  /** 标记某广播 pending 已跳过(无懈可击"不回应"后避免重复弹窗) */
  markBroadcastSkipped: (key: string) => void;
  /** 倒计时基准(pending 优先,否则 turnDeadline) */
  deadline: number | null;
}

interface AtomLike {
  requestType?: string;
  prompt?: { cardFilter?: { min?: number; max?: number } };
}

function readAtom(pending: PendingView | null): AtomLike | null {
  if (!pending?.atom) return null;
  return pending.atom as unknown as AtomLike;
}

/**
 * 推导 pending 相关派生状态。
 * @param view          引擎视图
 * @param perspectiveIdx 当前视角座次
 */
export function usePendingState(view: GameView, perspectiveIdx: number): PendingState {
  const pending = view.pending;
  const pendingTargetIdx = pending?.target ?? -1;
  const isPerspectiveAwaiting = pending !== null && (pendingTargetIdx < 0 || pendingTargetIdx === perspectiveIdx);

  const atom = readAtom(pending);
  const reqType = atom?.requestType;
  const isDiscardPhase = pending !== null && reqType === '__弃牌';
  const discardMin = isDiscardPhase ? (atom?.prompt?.cardFilter?.min ?? 0) : 0;
  const discardMax = isDiscardPhase ? (atom?.prompt?.cardFilter?.max ?? discardMin) : 0;

  // pending 变化时清空广播跳过标记
  const pendingKey = pending ? `${pending.atom?.type}:${reqType}` : '';
  const [skippedBroadcast, setSkippedBroadcast] = useState<Set<string>>(new Set());
  useEffect(() => { setSkippedBroadcast(new Set()); }, [pendingKey]);

  const markBroadcastSkipped = useMemo(() => (key: string) => {
    setSkippedBroadcast(prev => new Set(prev).add(key));
  }, []);

  const deadline = pending?.deadline ?? view.turnDeadline;

  return {
    pending,
    pendingTargetIdx,
    isPerspectiveAwaiting,
    isDiscardPhase,
    discardMin,
    discardMax,
    skippedBroadcast,
    markBroadcastSkipped,
    deadline,
  };
}
