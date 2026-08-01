// src/client/hooks/useAutoSkip.ts
// 前端自动跳过 hook:监听 pending 变化,按 decideAutoSkipForView 决策代发 skip。
//
// 维度1(强制):无法响应时自动跳过。空手牌立即,有手牌随机延迟(防手牌信息泄露)。
// 维度2(可选):用户开启策略跳过(optInSkip)时,无论能否响应都延迟跳过。
//
// 决策结果为 act-now/act-delayed 时发 skip(act-delayed 用 setTimeout)。
// 以 pending.deadline 去重,同一窗口只跳一次。pending 变化时清理上一个定时器。
// 广播型 pending 跳过后调 markBroadcastSkipped 隐藏本地弹窗(与手动「不回应」一致)。

import { useEffect, useRef } from 'react';
import type { GameView, Json } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import type { PendingRespondInfo } from '../utils/pendingRespond';
import { decideAutoSkipForView, type AutoSkipPrefs } from '../utils/autoSkip';

export interface UseAutoSkipInput {
  view: GameView;
  perspectiveIdx: number;
  skillActions: SkillActionDef[];
  pendingRespondInfo: PendingRespondInfo | null;
  prefs: AutoSkipPrefs;
  /** 是否可操作(非回放/旁观) */
  canOperate: boolean;
  /** 当前视角是否在等待回应(广播型 target<0 也算) */
  isPerspectiveAwaiting: boolean;
  /** 广播跳过标记(广播 pending 发 skip 后调,隐藏弹窗) */
  markBroadcastSkipped: (key: string) => void;
  broadcastKey: string;
  /** 发送 action(底层) */
  send: (skillId: string, actionType: string, params: Record<string, Json>) => void;
}

export function useAutoSkip(input: UseAutoSkipInput): void {
  const {
    view, perspectiveIdx, skillActions, pendingRespondInfo, prefs,
    canOperate, isPerspectiveAwaiting, markBroadcastSkipped, broadcastKey, send,
  } = input;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDeadlineRef = useRef<number | null>(null);

  useEffect(() => {
    // 清理上一个定时器(pending 变化或组件卸载)
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!canOperate || !isPerspectiveAwaiting) return;

    const pending = view.pending;
    if (!pending) return;

    // 去重:同一窗口(deadline)只决策一次
    const deadline = pending.deadline ?? 0;
    if (deadline === lastDeadlineRef.current) return;

    const decision = decideAutoSkipForView({
      view, viewer: perspectiveIdx, skillActions, pendingRespondInfo, prefs,
    });

    if (decision.kind === 'wait') return;

    lastDeadlineRef.current = deadline;
    const fire = () => {
      send('__skip', 'skip', {});
      // 广播型:标记本地跳过(隐藏弹窗,与手动「不回应」一致)
      if (pending.target < 0) markBroadcastSkipped(broadcastKey);
    };

    if (decision.kind === 'act-now') {
      fire();
    } else {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fire();
      }, decision.ms);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view, perspectiveIdx, skillActions, pendingRespondInfo, prefs,
    canOperate, isPerspectiveAwaiting, broadcastKey,
  ]);

  // 卸载清理
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
