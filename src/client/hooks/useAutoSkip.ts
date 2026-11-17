// src/client/hooks/useAutoSkip.ts
// 前端自动跳过 hook:监听 pending 变化,按 decideAutoSkipForView 决策代发 skip。
//
// 维度1(强制):无法响应时自动跳过。空手牌立即,有手牌随机延迟(防手牌信息泄露)。
// 维度2(可选):用户开启策略跳过(optInSkip)时,无论能否响应都延迟跳过。
//
// 编排(清定时器/deadline 去重/延迟触发/防串扰校验)由共享的 createAutoSkipScheduler
// 承担(与 HeadlessGameClient.maybeAutoSkipBroadcast 同一实现);本 hook 只接 view
// 变化通知与 fire 回调。以 pending.deadline 去重,同一窗口只跳一次。
// 广播型 pending 跳过后调 markBroadcastSkipped 隐藏本地弹窗(与手动「不回应」一致)。

import { useEffect, useRef } from 'react';
import type { GameView, Json, PendingView } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';
import type { PendingRespondInfo } from '../utils/pendingRespond';
import {
  createAutoSkipScheduler,
  decideAutoSkipForView,
  type AutoSkipPrefs,
  type AutoSkipScheduler,
} from '../utils/autoSkip';
import { SKIP_ACTION_TYPE, SKIP_SKILL_ID } from '../utils/skipMessage';

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

  // 最新 view ref:延迟 skip 触发时校验窗口未变(防串扰双保险,scheduler 经
  // getLatestPending 读取,与 headless 读实时 this._view 同一语义)
  const latestViewRef = useRef(view);
  latestViewRef.current = view;
  // fire 回调 latest-ref:scheduler 持有的固定 fire 始终调用最新渲染闭包。
  // broadcastKey 变化必触发 effect 重跑清定时器,故 fire 时的 broadcastKey 与决策时一致。
  const fireRef = useRef<(pending: PendingView) => void>(() => {});
  fireRef.current = (pending) => {
    send(SKIP_SKILL_ID, SKIP_ACTION_TYPE, {});
    // 广播型:标记本地跳过(隐藏弹窗,与手动「不回应」一致)
    if (pending.target < 0) markBroadcastSkipped(broadcastKey);
  };
  // 调度器跨 effect 保留实例(deadline 去重状态不能随渲染重置)
  const schedulerRef = useRef<AutoSkipScheduler | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = createAutoSkipScheduler(
      () => latestViewRef.current.pending ?? null,
      (pending) => fireRef.current(pending),
    );
  }

  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    if (!canOperate || !isPerspectiveAwaiting) {
      // 清理上一个定时器(pending 变化或组件卸载)
      scheduler.cancel();
      return;
    }
    const pending = view.pending;
    if (!pending) {
      scheduler.cancel();
      return;
    }
    scheduler.schedule(pending, () =>
      decideAutoSkipForView({
        view, viewer: perspectiveIdx, skillActions, pendingRespondInfo, prefs,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view, perspectiveIdx, skillActions, pendingRespondInfo, prefs,
    canOperate, isPerspectiveAwaiting, broadcastKey,
  ]);

  // 卸载清理
  useEffect(() => {
    return () => {
      schedulerRef.current?.cancel();
    };
  }, []);
}
