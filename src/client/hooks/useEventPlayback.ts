// src/client/hooks/useEventPlayback.ts
// 事件播放 hook:ViewEvent 按 seq 入队。结构事件(回合/阶段)只响音效+进历史条,
// 不进横幅队列;牌操作事件进中央横幅逐个展示,duration 到点出队。
// ingested(每批新鲜事件)独立于横幅队列,供音效/历史条/飞牌动画立即消费。
//
// 非阻塞语义:横幅 pointer-events:none,本 hook 只负责时序调度,不拦截交互。
//
// 过时事件处理:新批次 seq <= 已处理最大值时丢弃。

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ViewEvent } from '../../engine/types';
import { getAtomDef } from '../../engine/core/atom';

/** 最小可见时长(ms),保证事件能被看清,即便 effect.duration 偏短 */
const MIN_VISIBLE_MS = 400;

/** 箭头类事件最小播放时长(ms),保证 ActionOverlay 有足够时间渲染箭头。
 *  指定目标/成为目标 atom 的 effect.duration 仅 400ms,与 MIN_VISIBLE_MS 相同;
 *  多个事件同批到达时队列快速推进,后续事件会在 400ms 内覆盖当前事件,
 *  React 渲染周期 + findSeatEl DOM 查询来不及完成,箭头来不及渲染或一闪而过。 */
const ARROW_MIN_MS = 1200;
/** 需要延长播放时长的事件类型(携带 source+target 的箭头触发事件) */
const ARROW_EVENT_TYPES = new Set(['指定目标', '成为目标']);

/**
 * 结构性事件:回合/阶段开始·结束。这些事件无卡牌、无目标,中央横幅本就不渲染它们
 * (EventBanner 需 card 字段,ActionOverlay 需 target),进入播放队列只是 duration 空转,
 * 会阻塞后续牌操作事件的展示。让它们退出 banner 队列(仅响音效 + 进历史条),
 * 回合切换不再串行累积数百毫秒延迟。
 */
const STRUCTURAL_TYPES = new Set(['回合开始', '回合结束', '阶段开始', '阶段结束']);

function isStructural(event: ViewEvent): boolean {
  return STRUCTURAL_TYPES.has(event.type);
}

export interface QueuedEvent {
  seq: number;
  event: ViewEvent;
}

export interface EventPlaybackState {
  /** 待播事件队列(seq 升序) */
  queue: QueuedEvent[];
  /** 当前正在播放的事件(null = 空闲) */
  current: QueuedEvent | null;
}

/**
 * 事件播放队列。
 *
 * @returns { current, ingested, enqueue, reset }
 *   - current: 当前延时播放中的事件(箭头/判定翻牌等)
 *   - ingested: 最近一次入队的新鲜事件批次(出牌历史条应立即消费,不等播放队列)
 */
export function useEventPlayback() {
  const [current, setCurrent] = useState<QueuedEvent | null>(null);
  /** 最近入队批次;每次 enqueue 新鲜事件时更新,供 PlayHistory 立即入条 */
  const [ingested, setIngested] = useState<QueuedEvent[]>([]);
  const queueRef = useRef<QueuedEvent[]>([]);
  const lastPlayedSeqRef = useRef(0);
  /** ingested 去重 seq:结构事件不入播放队列、不推进 lastPlayedSeqRef,
   *  需独立跟踪已入 ingested 的最大 seq,防止重复。 */
  const ingestedSeqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用 ref 而非 current state 判断是否正在播放:多条 WS 消息在同一 tick 内同步到达时,
  // current state 在闭包中还是旧值(null),会导致 playNext 被重复调用,事件被瞬间覆盖。
  // ref 是同步可变的,不受 React render 周期影响。
  const isPlayingRef = useRef(false);

  /** 从队列取下一个播放 */
  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      isPlayingRef.current = false;
      setCurrent(null);
      return;
    }
    isPlayingRef.current = true;
    setCurrent(next);
    // duration:ViewEvent 自带 effect → atom 静态 effect(atomType 优先)→ 下限
    // 注意:打出/弃牌 等 ViewEvent.type 不是 atom 名,必须用 atomType,且查表失败时不能抛。
    const type = next.event.atomType ?? next.event.type;
    let staticDuration: number | undefined;
    try {
      staticDuration = getAtomDef(type).effect?.duration;
    } catch {
      staticDuration = undefined;
    }
    const eventEffect = next.event.effect as { duration?: number } | undefined;
    const duration = eventEffect?.duration ?? staticDuration ?? MIN_VISIBLE_MS;
    // 箭头类事件(指定目标/成为目标)强制更长最小播放时长,避免后续事件过快覆盖、
    // 箭头来不及渲染。其他事件仍走 MIN_VISIBLE_MS 下限。
    const isArrowEvent = ARROW_EVENT_TYPES.has(next.event.type);
    const minMs = isArrowEvent ? ARROW_MIN_MS : MIN_VISIBLE_MS;
    const wait = Math.max(duration, minMs);
    timerRef.current = setTimeout(() => {
      lastPlayedSeqRef.current = next.seq;
      playNext();
    }, wait);
  }, []);

  /**
   * 入队一批事件并开始播放(若空闲)。
   * 过时事件(seq <= lastPlayedSeq)被丢弃。
   * 新鲜事件同时写入 ingested,供出牌历史「使用时立即展示」。
   */
  const enqueue = useCallback(
    (events: QueuedEvent[]) => {
      if (events.length === 0) return;
      // ingested 去重:用独立 seq ref,不受 banner 队列推进影响
      const fresh = events.filter((e) => e.seq > ingestedSeqRef.current);
      if (fresh.length === 0) return;
      ingestedSeqRef.current = Math.max(...fresh.map((e) => e.seq));
      // 每次入队用新数组引用,确保下游 useEffect 能触发
      setIngested(fresh.map((e) => e));
      // 结构事件(回合/阶段)不进 banner 队列:它们无 card/target,横幅不渲染,
      // 入队只是 duration 空转,会阻塞后续牌操作事件。音效由 useSoundPlayback 跟 ingested 响。
      const bannerEvents = fresh.filter((e) => !isStructural(e.event));
      if (bannerEvents.length > 0) {
        queueRef.current.push(...bannerEvents);
        // 若空闲,立即开始播放(用 ref 判断,避免闭包竞态)
        if (!isPlayingRef.current) {
          playNext();
        }
      }
    },
    [playNext],
  );

  /** 重置(重连时清空状态,避免播放历史事件) */
  const reset = useCallback((baselineSeq: number) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    queueRef.current = [];
    isPlayingRef.current = false;
    setCurrent(null);
    setIngested([]);
    lastPlayedSeqRef.current = baselineSeq;
    ingestedSeqRef.current = baselineSeq;
  }, []);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { current, ingested, enqueue, reset };
}
