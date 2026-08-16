// src/client/replay/replayEngine.ts
// 回放引擎:纯函数,从 baseline + seatDelta 合并出 initialView,再逐步 applyView
// 重建任意时刻 GameView。与 viewReducer 对称:实时游戏用 applyView 增量更新,
// 回放也用 applyView 逐条重放。

import { viewReducer } from '../view/reducer';
import type { Card, GameView } from '../../engine/types';
import type { ReplayBaseline, ReplayFile, SeatDelta } from './types';

/** 取某座次录像的总步数(events 长度) */
export function totalSteps(delta: SeatDelta | undefined): number {
  return delta?.events.length ?? 0;
}

/** 合并 baseline + seatDelta,重建该座次的完整 initialView。
 *  深拷贝 baseline,回填 viewer/手牌/身份,返回独立副本(避免污染录像原始数据)。 */
function reconstructInitialView(baseline: ReplayBaseline, delta: SeatDelta): GameView {
  const view: GameView = JSON.parse(JSON.stringify(baseline)) as GameView;
  view.viewer = delta.viewer;
  // 回填私有手牌 + 身份可见性。
  // 手牌必须复制数组本体:viewReducer 会原地 push/splice view.players 的 hand,
  // 若直接引用 delta.privateHands 的数组,每次 getViewAt(逐步重放/切视角)都会把
  // 发牌/摸牌事件的牌累积写回录像原始数据,表现为「手牌一直重复」。
  const handMap = new Map<number, Card[]>();
  for (const { index, hand } of delta.privateHands) handMap.set(index, [...hand]);
  const idMap = new Map<number, { identity?: string; identityHidden?: boolean }>();
  for (const { index, identity, identityHidden } of delta.identityView) {
    idMap.set(index, { identity, identityHidden });
  }
  view.players = view.players.map((p) => {
    const id = idMap.get(p.index);
    return {
      ...p,
      hand: handMap.get(p.index),
      identity: id?.identity,
      identityHidden: id?.identityHidden,
    };
  });
  return view;
}

/** 取某座次第 step 步的 GameView:重建 initialView,applyView 前 step 个 events */
export function getViewAt(file: ReplayFile, seat: number, step: number): GameView | null {
  const delta = file.seats[seat];
  if (!delta) return null;
  const view = reconstructInitialView(file.baseline, delta);
  const clamped = Math.max(0, Math.min(step, delta.events.length));
  for (let i = 0; i < clamped; i++) {
    const { event, time } = delta.events[i];
    const type = typeof event.atomType === 'string' ? event.atomType : event.type;
    // notify 事件(pendingResolved 等):实时前端把 notify 和 atom ViewEvent 分开处理
    // (msg.notify 字段 vs msg.view 字段),viewReducer 只处理 atom ViewEvent。
    // 录像中若混入 notify(测试 harness 场景),回放时单独处理 pending 清除。
    if (type === 'notify') {
      if ((event.eventType as string) === 'pendingResolved') {
        const target = (event.data as { target?: number } | undefined)?.target;
        if (target !== undefined) {
          // 宽松清除:target<0(系统)、target===viewer(前端逻辑)、
          // 或 pending.target===target(harness 逻辑)任一满足即清
          if (target < 0 || target === view.viewer || view.pending?.target === target) {
            view.pending = null;
          }
        }
      }
      continue;
    }
    viewReducer(view, event, time);
  }
  return view;
}

/** 录像中有数据的所有座次下标(升序) */
export function availableSeats(file: ReplayFile): number[] {
  return Object.keys(file.seats)
    .map(Number)
    .sort((a, b) => a - b);
}

/** 取某座次第 step 步对应的事件描述(用于操作列表/进度提示) */
export function getEventAt(
  file: ReplayFile,
  seat: number,
  step: number,
): { seq: number; time: number; description: string } | null {
  const delta = file.seats[seat];
  if (!delta) return null;
  // step 指向"即将播放的第 step 个事件";step-1 是"已播放的最后一个"
  // 返回当前步的事件(step 从1开始有意义,step=0 无事件)
  const idx = step - 1;
  if (idx < 0 || idx >= delta.events.length) return null;
  const e = delta.events[idx];
  // seq = 数组下标(v2 已去除冗余 seq 字段,下标即序号)
  return { seq: idx, time: e.time, description: e.event.type };
}
