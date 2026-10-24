// core/run-tracker.ts — 执行生命周期:追踪「正在推进」的 execute,取代宏任务轮询。
//
// 一个 run = 一段正在推进的引擎执行(dispatch 的 execute 链 / 超时编排)。
// run 只有两种状态:
//   · active    —— 正在运行,或在等非 pending 的异步(动态 import、微任务链)
//   · suspended —— 挂在 PendingSlot 上等玩家回应/超时
// 稳定点 = active run 数归零:所有流程都已完成或挂在 slot 上。
//
// 关键不变量:slot resolve 时,**同步**把等待它的 run 记回 active(先于其 promise 续体),
// 因此「回应 execute 结束」与「父 execute 恢复」之间 active 数永远不会假归零。
// 并行 slot(选将)由 SlotGroup 合并:最后一个 slot resolve 才算父 run 恢复。
//
// 运行时数据只存在于 WeakMap,不进入快照/view。
import type { GameState } from '../types';

interface RunTracker {
  active: number;
  idle: { promise: Promise<void>; resolve: () => void } | null;
  /** 归零次数:只在 run 转 suspended/结束时递增,不会因 beginRun 回退。 */
  idleCount: number;
}

const trackers = new WeakMap<GameState, RunTracker>();

function tracker(state: GameState): RunTracker {
  let t = trackers.get(state);
  if (!t) {
    t = { active: 0, idle: null, idleCount: 0 };
    trackers.set(state, t);
  }
  return t;
}

function release(t: RunTracker): void {
  t.active -= 1;
  // 先记账再唤醒:waiters 的续体是微任务,此时 active 已是本次归零后的值。
  t.idleCount += 1;
  if (t.active > 0) return;
  t.active = 0;
  const idle = t.idle;
  t.idle = null;
  idle?.resolve();
}

/** 登记一个 active run;返回幂等的结束函数。 */
export function beginRun(state: GameState): () => void {
  const t = tracker(state);
  t.active += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    release(t);
  };
}

/** 登记一个「脱离父链」的 fire-and-forget 执行(startTurn 的出牌窗口循环等)。
 *  这类链不受任何 execute 的 settle 覆盖,必须自己持有一个 run,
 *  否则它挂到 slot 上时会释放别人的 credit,导致 active 计数漂移、settle 提前。
 *  错误经 state.onError 上报。 */
export function runDetached(state: GameState, task: (state: GameState) => Promise<void>): void {
  const endRun = beginRun(state);
  void task(state)
    .catch((error: unknown) => {
      state.onError?.(error instanceof Error ? error : new Error(String(error)));
    })
    .finally(endRun);
}

/** 当前归零序号(取样后传给 whenIdleSince)。 */
export function currentIdleCount(state: GameState): number {
  return tracker(state).idleCount;
}

/** 自某个归零序号之后的稳定点。
 *
 *  dispatch 必须在「自己的 run 结束之后」才 settle:直接用 whenIdle 会命中调用瞬间就已
 *  存在的 0 计数(execute 的启动在微任务里,run 尚未结束),settle 便先于 execute 完成,
 *  await settle 的调用方(restore/测试)会读到半成品状态。 */
export async function whenIdleSince(state: GameState, idleCount: number): Promise<void> {
  const t = tracker(state);
  while (t.active > 0 || t.idleCount <= idleCount) {
    if (!t.idle) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      t.idle = { promise, resolve };
    }
    // release 会先清空 t.idle 再 resolve,续体醒来时重新检查(不丢唤醒)。
    await t.idle.promise;
  }
}

/** 稳定点:无 active run 时立即 resolve,否则等归零。 */
export function whenIdle(state: GameState): Promise<void> {
  const t = tracker(state);
  if (t.active === 0) return Promise.resolve();
  if (!t.idle) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    t.idle = { promise, resolve };
  }
  return t.idle.promise;
}

/** 一次 pending 挂起涉及的 slot 集合。 */
export interface SlotGroup {
  /** 每个 slot resolve 时调用(幂等由 slot 自己的 safeResolve 保证)。 */
  slotResolved(): void;
  /** 全部 slot 已创建后调用:当前执行链转入 suspended。 */
  suspend(): void;
}

/**
 * 当前执行链挂起/恢复的计数记账。
 *
 * 只有「已被某个 run 持有」的链才有 credit 可让出:没有任何 active run 时(测试直接
 * applyAtom 等待型 atom)suspend 不动计数,resolve 也不补回,计数不会漂移。
 * 生产路径的每条链都由 dispatch 的 execute 或 fireTimeoutNow 的超时编排持有。
 */
export function createSlotGroup(state: GameState, count: number): SlotGroup {
  const t = tracker(state);
  let remaining = count;
  let credited = false;
  return {
    suspend() {
      // slot 在 Promise executor 内同步创建;remaining===0 说明已同步全部 resolve,无需挂起。
      if (remaining === 0 || t.active === 0) return;
      credited = true;
      release(t);
    },
    slotResolved() {
      remaining -= 1;
      if (remaining === 0 && credited) {
        credited = false;
        t.active += 1;
      }
    },
  };
}
