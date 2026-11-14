// src/server/serialChain.ts — per-room 串行执行链共享实现。
//
// persistence(快照落盘/flush/删除)、eventJournal(journal append/remove)、
// gameHistory(历史 index 写入)三处曾各自维护同构的 Map<roomId, Promise> 链,
// 现统一到这里。并发语义:同一 roomId 的操作按到达顺序执行,后到的操作等待
// 先前的完成——无论先前成败,本操作都会执行(失败不阻断后续);链尾落定后
// 从 Map 清理条目,避免无限增长。
//
// 错误策略由各模块注入,保持其原有可观察行为:
// - 默认(不注入 onError):本操作失败把错误抛给调用方;
// - 注入 onError:错误被吞掉并交由回调记录,链上 promise 永不 reject
//   (fire-and-forget 落盘模块用,对局不受磁盘故障影响)。

/** 本操作失败时的处理回调(提供后链上 promise 永不 reject)。 */
export type SerialChainOnError = (roomId: string, err: unknown) => void;

export interface RoomSerialChain {
  /** 链名(诊断/清理注册标识)。 */
  readonly name: string;
  /** roomId → 进行中的链尾。暴露给调用方做 registerLifecycle 清理注册。 */
  readonly chains: Map<string, Promise<unknown>>;
  /** 串行执行 op:后到的操作等先前的完成(无论先前成败),失败不阻断后续。 */
  enqueue<T>(roomId: string, op: () => Promise<T>): Promise<T>;
}

/** 创建一条 per-room 串行链。name 仅作诊断/清理注册标识。 */
export function createRoomSerialChain(
  name: string,
  options: { onError?: SerialChainOnError } = {},
): RoomSerialChain {
  const chains = new Map<string, Promise<unknown>>();
  return {
    name,
    chains,
    enqueue<T>(roomId: string, op: () => Promise<T>): Promise<T> {
      const prev = chains.get(roomId) ?? Promise.resolve();
      // 前序无论成功/失败都继续执行本操作(失败不阻断后续)。
      let next: Promise<T> = prev.then(
        () => op(),
        () => op(),
      );
      if (options.onError) {
        const { onError } = options;
        // 吞掉错误交由调用方记录:链上 promise 永不 reject。
        next = next.catch((err) => {
          onError(roomId, err);
        }) as Promise<T>;
      }
      chains.set(roomId, next);
      // 链尾落定后清理条目;无论成败都清(失败链不留在 Map 里毒化后续)。
      void next.then(
        () => {
          if (chains.get(roomId) === next) chains.delete(roomId);
        },
        () => {
          if (chains.get(roomId) === next) chains.delete(roomId);
        },
      );
      return next;
    },
  };
}
