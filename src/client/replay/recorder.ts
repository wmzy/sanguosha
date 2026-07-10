// src/client/replay/recorder.ts
// 录制器:收集各座次的 ViewEvent,游戏结束时组装为 ReplayFile。
//
// 接入点:连接层(useDebugMultiConnection / useMultiplayerRoom)在 HGC onView
// 回调中拿到 newEvents 后调用 record()。
//
// initialView 在座次首次产生非空 view 时深拷贝捕获(JSON 序列化剥离函数引用)。

import type { GameView, ViewEvent } from '../../engine/types';
import type { ReplayFile, ReplayMeta, SeatRecording } from './types';

/** 深拷贝 GameView(剥离函数引用,保证 JSON 可序列化) */
function cloneView(view: GameView): GameView {
  return JSON.parse(JSON.stringify(view)) as GameView;
}

export class ReplayRecorder {
  /** seatIndex → 录像 */
  private seats = new Map<number, SeatRecording>();
  /** 各座次内部 seq 计数器 */
  private seqCounters = new Map<number, number>();
  /** 各座次是否已捕获 initialView */
  private initialized = new Set<number>();

  /**
   * 记录某座次收到的事件批次。
   *
   * @param seat 座次下标
   * @param view 该座次当前 GameView(用于首次捕获 initialView)
   * @param events 本次新事件
   */
  record(seat: number, view: GameView | null, events: ViewEvent[], now: number = Date.now()): void {
    // 首次产生非空 view 时捕获 initialView
    if (view && !this.initialized.has(seat)) {
      this.seats.set(seat, {
        seatIndex: seat,
        playerName: view.players[seat]?.name ?? `P${seat}`,
        initialView: cloneView(view),
        events: [],
      });
      this.seqCounters.set(seat, 0);
      this.initialized.add(seat);
    }

    const rec = this.seats.get(seat);
    if (!rec) return; // 座次未初始化(还没有 view),丢弃事件

    let seq = this.seqCounters.get(seat) ?? 0;
    for (const event of events) {
      rec.events.push({ seq, time: now, event });
      seq++;
    }
    this.seqCounters.set(seat, seq);
  }

  /** 是否有可导出的录像数据(至少一个座次已初始化) */
  hasData(): boolean {
    return this.initialized.size > 0;
  }

  /** 组装最终录像文件。游戏结束时调用。 */
  finalize(meta: ReplayMeta): ReplayFile {
    const seats: Record<number, SeatRecording> = {};
    for (const [seat, rec] of this.seats) {
      seats[seat] = rec;
    }
    return { format: 'sanguosha-replay', version: 1, meta, seats };
  }

  /** 清空(新一局重置) */
  reset(): void {
    this.seats.clear();
    this.seqCounters.clear();
    this.initialized.clear();
  }
}
