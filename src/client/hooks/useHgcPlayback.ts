// src/client/hooks/useHgcPlayback.ts
// HGC 连接共用的事件播放/出牌历史簿记。
//
// useMultiplayerRoom(单连接,正式房)与 useDebugMultiConnection(N 座次,调试房)
// 各自维护连接生命周期,但对 playback 队列的用法完全一致:
//   - playbackRef 镜像:HGC 回调(onMessage/onView)闭包需要同步可变引用,
//     直接捕获 hook 返回值会在实例重建后读到旧队列;
//   - ingestedEvents 出牌历史:onView.newEvents 批次追加(不可整批替换,
//     WS 连发时 React 会合并 setState 丢掉中间批次,见 appendIngestedEvents);
//   - event 消息入队:中央动效横幅逐个播放(他人出牌/判定翻牌等);
//   - game_reset 清理:历史缓冲 + 序号水位 + 播放队列一并清空。
// 两个连接 hook 改为消费本 hook;单连接命令状态机与 N 座次单活流调度是真差异,
// 不在收敛范围。
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ViewEvent } from '../../engine/types';
import { useEventPlayback } from './useEventPlayback';
import type { QueuedEvent } from './useEventPlayback';
import { appendIngestedEvents } from '../utils/appendIngestedEvents';

/** useEventPlayback 的实例类型(队列操作句柄) */
type EventPlayback = ReturnType<typeof useEventPlayback>;

export interface HgcPlayback {
  /** 播放队列实例的 ref 镜像(连接 effect 闭包内安全取最新实例) */
  playbackRef: RefObject<EventPlayback>;
  /** 刚入队的事件批次:出牌历史条立即消费(不等播放队列) */
  ingestedEvents: QueuedEvent[];
  /** 出牌历史批次入队(onView.newEvents 驱动;空批次自动跳过) */
  ingestEvents: (newEvents: readonly ViewEvent[]) => void;
  /** 中央动效事件入队(event 消息驱动:他人出牌/判定翻牌等) */
  enqueueEvent: (seq: number, event: ViewEvent) => void;
  /** game_reset/再来一局清理:清空历史缓冲、序号水位与播放队列 */
  resetPlayback: () => void;
  /** 当前播放的事件(供 GameViewComponent 中央动效展示) */
  currentEvent: QueuedEvent | null;
  /** 待播事件队列积压数(>1 时 GameView 横幅显示「+N 排队中」角标) */
  pendingCount: number;
  /** 一键清空事件播放积压(横幅角标 ⏭,立即对齐到最新事件) */
  skipEvents: () => void;
}

/**
 * 事件播放 + 出牌历史的共用簿记。
 *
 * @param options.compact 观战/追赶模式(正式房旁观者传 true:不补播历史动效,
 *   始终展示最新事件);调试房不传。
 */
export function useHgcPlayback(options: { compact?: boolean } = {}): HgcPlayback {
  const playback = useEventPlayback({ compact: options.compact });
  const playbackRef = useRef(playback);
  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);
  /** 出牌历史:由 onView.newEvents 驱动(与播放队列解耦,使用时立即入条) */
  const [ingestedEvents, setIngestedEvents] = useState<QueuedEvent[]>([]);
  const historySeqRef = useRef(0);
  const ingestEvents = useCallback((newEvents: readonly ViewEvent[]) => {
    if (newEvents.length === 0) return;
    setIngestedEvents((prev) =>
      appendIngestedEvents(prev, newEvents, () => ++historySeqRef.current),
    );
  }, []);
  const enqueueEvent = useCallback((seq: number, event: ViewEvent) => {
    playbackRef.current.enqueue([{ seq, event }]);
  }, []);
  const resetPlayback = useCallback(() => {
    setIngestedEvents([]);
    historySeqRef.current = 0;
    playbackRef.current.reset(0);
  }, []);
  return {
    playbackRef,
    ingestedEvents,
    ingestEvents,
    enqueueEvent,
    resetPlayback,
    currentEvent: playback.current,
    pendingCount: playback.pendingCount,
    skipEvents: playback.skipAll,
  };
}

/** 归一 HGC/REST 错误为可展示文案(Error.message,非 Error 转 String)。 */
export function normalizeHgcError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
