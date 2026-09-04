// core/clock.ts — 时间源抽象:统一真实定时器与虚拟时钟。
//
// 引擎内部时间语义统一为「相对 game startedAt 的单调毫秒」:
//   now() 返回绝对单调毫秒(RealClock=Date.now, VirtualClock=虚拟时间),
//   调用方用 now() - state.startedAt 得到相对时间。
//   schedule(delayMs, fn) 在 now()+delayMs 时刻触发 fn,返回取消函数。
//
// 引入动机(架构讨论结论):
//   1. 重放(restore)需要确定性超时——超时是「时间戳 + 确定时长」的纯函数推导,
//      不应依赖真实系统时间。虚拟时钟在重放时按 actionLog 时间戳精确推进,
//      自然触发到期超时,消除 drainUnresolvedBlockingSlots 的「猜超时」逻辑。
//   2. 真实 setTimeout 与竞态处理(slot.pause/clearTimeout/isTimeout)是
//      执行模型的历史债,Clock 抽象统一两套语义。

export interface Clock {
  /** 当前绝对单调毫秒(RealClock=Date.now;VirtualClock=虚拟时间)。 */
  now(): number;
  /** 在 now()+delayMs 时刻调度 fn。返回取消函数(已触发或取消后 fn 不再执行)。 */
  schedule(delayMs: number, fn: () => void | Promise<void>): () => void;
}

/** 真实时钟:包装 Date.now + setTimeout。正常对局默认使用。 */
export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }

  schedule(delayMs: number, fn: () => void | Promise<void>): () => void {
    const timer = setTimeout(fn, delayMs);
    return () => clearTimeout(timer);
  }
}

/** 虚拟时钟:确定性重放用。时间由 advanceTo 显式推进,事件按到期顺序触发。 */
export class VirtualClock implements Clock {
  private current = 0;
  private events: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];

  now(): number {
    return this.current;
  }

  schedule(delayMs: number, fn: () => void | Promise<void>): () => void {
    const ev = { at: this.current + delayMs, fn, cancelled: false };
    this.events.push(ev);
    return () => {
      ev.cancelled = true;
    };
  }

  /** 推进到时刻 t(单调不减),按到期顺序 await 触发所有到期事件。
   *  循环收集以处理「事件触发过程中新 schedule 的到期事件」。
   *  fn 内部可能 schedule 新事件(如超时编排创建新 slot),其 at 基于推进后的 current。 */
  async advanceTo(t: number): Promise<void> {
    if (t < this.current) return;
    this.current = t;
    // 反复收集并触发到期事件,直到无到期事件(处理触发中新增的到期事件)。
    for (;;) {
      const due = this.events
        .filter((e) => !e.cancelled && e.at <= this.current)
        .sort((a, b) => a.at - b.at);
      if (due.length === 0) break;
      this.events = this.events.filter((e) => e.cancelled || e.at > this.current);
      for (const ev of due) {
        await ev.fn();
      }
    }
  }
}
