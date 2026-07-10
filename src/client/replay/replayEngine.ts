// src/client/replay/replayEngine.ts
// 回放引擎:纯函数,从某座次的 initialView 起步,逐步 applyView 重建任意时刻 GameView。
// 与 viewReducer 对称:实时游戏用 applyView 增量更新,回放也用 applyView 逐条重放。

import { viewReducer } from '../view/reducer';
import type { GameView } from '../../engine/types';
import type { ReplayFile, SeatRecording } from './types';

/** 取某座次录像的总步数(events 长度) */
export function totalSteps(rec: SeatRecording | undefined): number {
  return rec?.events.length ?? 0;
}

/** 深拷贝(回放导航每次都从 initialView 全量重建,避免累积突变污染原录像数据) */
function cloneView(view: GameView): GameView {
  return JSON.parse(JSON.stringify(view)) as GameView;
}

/** 取某座次第 step 步的 GameView:深拷贝 initialView,applyView 前 step 个 events */
export function getViewAt(file: ReplayFile, seat: number, step: number): GameView | null {
  const rec = file.seats[seat];
  if (!rec) return null;
  const view = cloneView(rec.initialView);
  const clamped = Math.max(0, Math.min(step, rec.events.length));
  for (let i = 0; i < clamped; i++) {
    const { event, time } = rec.events[i];
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
  const rec = file.seats[seat];
  if (!rec) return null;
  // step 指向"即将播放的第 step 个事件";step-1 是"已播放的最后一个"
  // 返回当前步的事件(step 从1开始有意义,step=0 无事件)
  const idx = step - 1;
  if (idx < 0 || idx >= rec.events.length) return null;
  const e = rec.events[idx];
  return { seq: e.seq, time: e.time, description: e.event.type };
}
