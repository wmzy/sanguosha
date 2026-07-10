// src/client/hooks/useReplay.ts
// 回放状态管理:步进/自动播放/速度/视角切换。
//
// 核心状态:seat(视角座次)+ step(当前步)+ playing(自动播放)+ speed(倍率)。
// 导航时通过 getViewAt(file, seat, step) 重建当前 GameView。

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { GameView } from '../../engine/types';
import type { ReplayFile } from '../replay/types';
import { getViewAt, totalSteps, availableSeats } from '../replay/replayEngine';

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

const SPEED_INTERVAL_MS: Record<ReplaySpeed, number> = {
  0.5: 2000,
  1: 1000,
  2: 500,
  4: 250,
};

export function useReplay(file: ReplayFile): UseReplayResult {
  const seats = useMemo(() => availableSeats(file), [file]);
  const [seat, setSeatState] = useState(() => seats[0] ?? 0);
  const max = useMemo(() => totalSteps(file.seats[seat]), [file, seat]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);

  // step 超出当前 seat 范围时 clamp(视角切换后)
  const effectiveStep = Math.min(step, max);

  const view = useMemo(
    () => getViewAt(file, seat, effectiveStep),
    [file, seat, effectiveStep],
  );

  // 自动播放定时器
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    // 到末尾停止
    if (effectiveStep >= max) {
      setPlaying(false);
      return;
    }
    timerRef.current = setInterval(() => {
      setStep((prev) => {
        const cur = Math.min(prev, totalSteps(file.seats[seat]));
        if (cur >= totalSteps(file.seats[seat])) {
          setPlaying(false);
          return cur;
        }
        return cur + 1;
      });
    }, SPEED_INTERVAL_MS[speed]);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [playing, speed, seat, effectiveStep, max, file]);

  const next = useCallback(() => {
    setStep((prev) => {
      const cur = Math.min(prev, totalSteps(file.seats[seat]));
      return Math.min(cur + 1, totalSteps(file.seats[seat]));
    });
  }, [file, seat]);

  const prev = useCallback(() => {
    setStep((p) => Math.max(0, Math.min(p, totalSteps(file.seats[seat])) - 1));
  }, [file, seat]);

  const goTo = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(target, totalSteps(file.seats[seat])));
      setStep(clamped);
      setPlaying(false);
    },
    [file, seat],
  );

  const setSeat = useCallback(
    (newSeat: number) => {
      setSeatState(newSeat);
      const newMax = totalSteps(file.seats[newSeat]);
      setStep((prev) => Math.min(prev, newMax));
      setPlaying(false);
    },
    [file],
  );

  const togglePlay = useCallback(() => {
    if (effectiveStep >= max) {
      // 在末尾时,从头开始
      setStep(0);
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
    next,
    prev,
    goTo,
    setSeat,
    togglePlay,
    setSpeed,
  };
}
