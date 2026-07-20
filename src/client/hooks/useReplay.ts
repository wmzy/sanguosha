// src/client/hooks/useReplay.ts
// 回放状态管理:步进/自动播放/速度/视角切换。
//
// 核心状态:seat(视角座次)+ step(当前步)+ playing(自动播放)+ speed(倍率)。
// 导航时通过 getViewAt(file, seat, step) 重建当前 GameView。
//
// 与实时游戏对齐:自动播放按「下一个 event 的 effect.duration / speed」节奏推进
// (而非固定间隔),并把当前正在播放的 event 同时暴露为 currentEvent(供 EventBanner/
// ActionOverlay 中央动效)与 ingestedEvents(供 PlayHistoryStrip 出牌历史条)。
// 这与 useEventPlayback 的语义一致:回放每一步 = 实时收到一个 ViewEvent。

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { GameView, ViewEvent } from '../../engine/types';
import type { ReplayFile } from '../replay/types';
import { getViewAt, totalSteps, availableSeats } from '../replay/replayEngine';
import { getAtomDef } from '../../engine/atom';
import type { QueuedEvent } from './useEventPlayback';

export type ReplaySpeed = 0.5 | 1 | 2 | 4;

export interface UseReplayResult {
  /** 当前步重建的 GameView */
  view: GameView | null;
  /** 当前步(从 0 开始,0 = initialView) */
  step: number;
  /** 总步数 */
  total: number;
  /** 当前视角座次 */
  seat: number;
  /** 可用座次列表 */
  seats: number[];
  /** 是否自动播放中 */
  playing: boolean;
  /** 当前速度倍率 */
  speed: ReplaySpeed;
  /** 当前正在播放的事件(对应已消费的最后一条 event)。
   *  供 GameView 内部 EventBanner/ActionOverlay 渲染延时动效,与实时一致。 */
  currentEvent: QueuedEvent | null;
  /** 最近一次单步推进产生的新鲜事件批次。
   *  供 PlayHistoryStrip 出牌历史条立即消费(导航跳转/切视角时为空)。 */
  ingestedEvents: QueuedEvent[];
  /** 导航 */
  next: () => void;
  prev: () => void;
  goTo: (step: number) => void;
  /** 切换视角座次(step 会 clamp 到该座次范围) */
  setSeat: (seat: number) => void;
  /** 切换自动播放 */
  togglePlay: () => void;
  /** 设置速度 */
  setSpeed: (speed: ReplaySpeed) => void;
}

/** 事件最小可见时长(ms),与 useEventPlayback 的 MIN_VISIBLE_MS 对齐 */
const MIN_VISIBLE_MS = 400;
/** duration 缺失时的回退间隔(ms) */
const FALLBACK_DURATION_MS = 400;

/** 取某 ViewEvent 的播放时长:
 *  1. ViewEvent 自带 effect.duration(派生事件如「打出」)
 *  2. atom 静态 effect.duration(查 atomType 优先)
 *  3. 兜底 FALLBACK_DURATION_MS
 *  与 useEventPlayback.playNext 的取值逻辑保持一致。 */
function computeEventDuration(event: ViewEvent): number {
  const type = (event as { atomType?: string; type?: string }).atomType ?? event.type;
  let staticDuration: number | undefined;
  try {
    staticDuration = getAtomDef(type).effect?.duration;
  } catch {
    staticDuration = undefined;
  }
  const eventEffect = event.effect as { duration?: number } | undefined;
  return eventEffect?.duration ?? staticDuration ?? FALLBACK_DURATION_MS;
}

export function useReplay(file: ReplayFile): UseReplayResult {
  const seats = useMemo(() => availableSeats(file), [file]);
  const [seat, setSeatState] = useState(() => seats[0] ?? 0);
  const max = useMemo(() => totalSteps(file.seats[seat]), [file, seat]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [currentEvent, setCurrentEvent] = useState<QueuedEvent | null>(null);
  const [ingestedEvents, setIngestedEvents] = useState<QueuedEvent[]>([]);

  // step 超出当前 seat 范围时 clamp(视角切换后)
  const effectiveStep = Math.min(step, max);

  const view = useMemo(
    () => getViewAt(file, seat, effectiveStep),
    [file, seat, effectiveStep],
  );

  // 推进到下一步并同步 currentEvent/ingestedEvents。
  // 自动播放与手动 next 共用:走完一步 = 实时收到一个 ViewEvent。
  const advance = useCallback(() => {
    setStep((prev) => {
      const cur = Math.min(prev, max);
      if (cur >= max) {
        setPlaying(false);
        return cur;
      }
      const newStep = cur + 1;
      const ev = file.seats[seat].events[newStep - 1];
      if (ev) {
        const qe: QueuedEvent = { seq: ev.seq, event: ev.event };
        setCurrentEvent(qe);
        setIngestedEvents([qe]);
      }
      return newStep;
    });
  }, [file, seat, max]);

  // 自动播放定时器:按「下一个待播 event 的 duration / speed」节奏推进。
  // 与实时游戏的 useEventPlayback 时序对齐(而非固定间隔)。
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    // 到末尾停止
    if (effectiveStep >= max) {
      setPlaying(false);
      return;
    }
    // 即将播放 events[effectiveStep],等待其 duration / speed
    const nextEvent = file.seats[seat].events[effectiveStep];
    const duration = nextEvent ? computeEventDuration(nextEvent.event) : FALLBACK_DURATION_MS;
    const wait = Math.max(duration, MIN_VISIBLE_MS) / speed;
    timerRef.current = setTimeout(() => {
      advance();
    }, wait);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing, speed, seat, effectiveStep, max, file, advance]);

  const next = useCallback(() => {
    advance();
  }, [advance]);

  const prev = useCallback(() => {
    setStep((p) => {
      const cur = Math.min(p, max);
      const newStep = Math.max(0, cur - 1);
      const ev = newStep > 0 ? file.seats[seat].events[newStep - 1] : null;
      // prev 同步更新 currentEvent(显示当前位置的横幅),但不入历史条(避免反向污染累加)
      setCurrentEvent(ev ? { seq: ev.seq, event: ev.event } : null);
      setIngestedEvents([]);
      return newStep;
    });
  }, [file, seat, max]);

  const goTo = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(target, max));
      setStep(clamped);
      setPlaying(false);
      // 跳转属于重新定位,清空节奏相关状态(EventBanner/历史条不在跳转点显示)
      setCurrentEvent(null);
      setIngestedEvents([]);
    },
    [max],
  );

  const setSeat = useCallback(
    (newSeat: number) => {
      setSeatState(newSeat);
      const newMax = totalSteps(file.seats[newSeat]);
      setStep((prev) => Math.min(prev, newMax));
      setPlaying(false);
      // 切视角后原事件不再相关
      setCurrentEvent(null);
      setIngestedEvents([]);
    },
    [file],
  );

  const togglePlay = useCallback(() => {
    if (effectiveStep >= max) {
      // 在末尾时,从头开始
      setStep(0);
      setCurrentEvent(null);
      setIngestedEvents([]);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  }, [effectiveStep, max]);

  return {
    view,
    step: effectiveStep,
    total: max,
    seat,
    seats,
    playing,
    speed,
    currentEvent,
    ingestedEvents,
    next,
    prev,
    goTo,
    setSeat,
    togglePlay,
    setSpeed,
  };
}
