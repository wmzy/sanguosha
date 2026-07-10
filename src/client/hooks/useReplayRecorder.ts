// src/client/hooks/useReplayRecorder.ts
// 录制 hook:在 React 中持有 ReplayRecorder 实例,连接层通过返回的方法接入录制。
//
// 用法:
//   const recorder = useReplayRecorder();
//   // 连接层 onView 回调中:
//   recorder.record(seat, view, newEvents);
//   // 游戏结束:
//   const file = recorder.finalize(meta);
//   saveReplay(file);

import { useRef, useCallback } from 'react';
import { ReplayRecorder } from '../replay/recorder';
import type { GameView, ViewEvent } from '../../engine/types';
import type { ReplayFile, ReplayMeta } from '../replay/types';

export function useReplayRecorder() {
  const recorderRef = useRef<ReplayRecorder>(new ReplayRecorder());

  const record = useCallback(
    (seat: number, view: GameView | null, events: ViewEvent[], now?: number) => {
      recorderRef.current.record(seat, view, events, now);
    },
    [],
  );

  const finalize = useCallback((meta: ReplayMeta): ReplayFile => {
    return recorderRef.current.finalize(meta);
  }, []);

  const hasData = useCallback(() => recorderRef.current.hasData(), []);

  const reset = useCallback(() => {
    recorderRef.current.reset();
  }, []);

  return { record, finalize, hasData, reset };
}
