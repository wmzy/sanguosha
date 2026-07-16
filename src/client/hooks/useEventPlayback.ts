// src/client/hooks/useEventPlayback.ts
// 事件播放队列 hook。
//
// 收到 ViewEvent 后(来自服务端 event 消息),按 seq 入队,逐个播放。
// "播放" = 暴露 current event 给 GameView 内部的 EventBanner 渲染延时展示,
// duration 到点后出队,推下一个。
//
// 非阻塞语义:EventBanner 用 pointer-events:none 实现,
// 本 hook 只负责时序调度,不拦截交互。
//
// 过时事件处理:若新批次 seq <= lastPlayedSeq(状态回退/重连),丢弃。
// 积压处理:队列过长时,对旧回合事件快速跳过(后续优化,当前逐个播放)。

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ViewEvent } from '../../engine/types';
import { getAtomDef } from '../../engine/atom';

/** 最小可见时长(ms),保证事件能被看清,即便 effect.duration 偏短 */
const MIN_VISIBLE_MS = 400;

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
 * @param incoming 新收到的事件批次(已按 seq 升序)。每收到一批调用一次。
 * @returns 当前播放状态 { current }
 *
 * 用法:useEventPlayback 在收到 events 消息时调用 enqueue,
 * 返回的 current 传给 GameView 的 currentEvent prop(EventBanner 渲染)。
 */
export function useEventPlayback() {
  const [current, setCurrent] = useState<QueuedEvent | null>(null);
  const queueRef = useRef<QueuedEvent[]>([]);
  const lastPlayedSeqRef = useRef(0);
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
    // duration 优先取 ViewEvent 自带 effect(移动牌等派生事件携带),
    // fallback 到 AtomDefinition.effect 静态查表(判定/展示等)。
    const type = next.event.atomType ?? next.event.type;
    const staticEffect = getAtomDef(type).effect;
    const eventEffect = next.event.effect as { duration?: number } | undefined;
    const duration = eventEffect?.duration ?? staticEffect?.duration ?? MIN_VISIBLE_MS;
    const wait = Math.max(duration, MIN_VISIBLE_MS);
    timerRef.current = setTimeout(() => {
      lastPlayedSeqRef.current = next.seq;
      playNext();
    }, wait);
  }, []);

  /**
   * 入队一批事件并开始播放(若空闲)。
   * 过时事件(seq <= lastPlayedSeq)被丢弃。
   */
  const enqueue = useCallback(
    (events: QueuedEvent[]) => {
      if (events.length === 0) return;
      // 过滤过时事件
      const fresh = events.filter((e) => e.seq > lastPlayedSeqRef.current);
      if (fresh.length === 0) return;
      queueRef.current.push(...fresh);
      // 若空闲,立即开始播放(用 ref 判断,避免闭包竞态)
      if (!isPlayingRef.current) {
        playNext();
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
    lastPlayedSeqRef.current = baselineSeq;
  }, []);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { current, enqueue, reset };
}
