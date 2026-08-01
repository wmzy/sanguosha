// src/client/hooks/useSoundPlayback.ts
// 音效播放 hook:跟随 useEventPlayback 的 current(正在播放的事件),
// 在事件"成为当前项"时响,与视觉横幅/动效同步、逐个串行。
//
// 为什么不用 ingested 批次:
//   实时对局中,服务端一次操作(如出杀)会接连推送多个 ViewEvent(打出/使用/伤害/扣血…)。
//   多条 SSE 消息常落在 React 同一渲染批次,setIngestedEvents 被合并,监听 ingested 的
//   useEffect 会在一次执行里同步播放整批音效 → 叠音("一个操作同时响多个音效")。
//   current 由 useEventPlayback 逐个出队(每事件等待其 effect.duration),天然串行,
//   音效跟随它即可做到"一个事件一声、不叠",且与视觉横幅同帧出现。
//
// effect 取值范式(与 EventBanner.tsx 一致):
//   const atomType = event.atomType ?? event.type;
//   const def = getAtomDef(atomType);             // 可能抛(派生事件 type 不在注册表),需 try/catch
//   const effect = (event.effect as EventEffect) ?? def.effect;
//   const soundId = effect?.sound;
//
// per-event 音量:effect.volume(0..1)与全局音量在 audioEngine 内部相乘。

import { useEffect, useRef } from 'react';
import type { ViewEvent } from '../../engine/types';
import { getAtomDef } from '../../engine/atom';
import { audioEngine } from '../sounds/audioEngine';
import type { QueuedEvent } from './useEventPlayback';

/** ViewEvent 自带的 effect 片段(移动牌等派生事件携带;静态 atom 走 getAtomDef) */
type EventEffect = { sound?: string; volume?: number } | undefined;

/**
 * 从 ViewEvent 提取 effect.sound / effect.volume。
 * 优先用 ViewEvent 自带 effect(派生事件),fallback 到 atom 静态 effect。
 * 查表失败(未注册 type)返回 null,不抛。
 */
function extractSound(event: ViewEvent): { sound: string; volume?: number } | null {
  const atomType = (event as { atomType?: string }).atomType ?? event.type;
  let staticEffect: EventEffect;
  try {
    staticEffect = getAtomDef(atomType).effect as EventEffect;
  } catch {
    staticEffect = undefined;
  }
  const effect = (event.effect as EventEffect) ?? staticEffect;
  if (!effect?.sound) return null;
  return { sound: effect.sound, volume: effect.volume };
}

/**
 * 音效播放 hook。跟随播放队列的 current 事件逐个发声。
 *
 * @param current  useEventPlayback 的 current(正在展示的事件)。
 *                 null/undefined 时无副作用。
 *
 * 同一 seq 只响一次:lastPlayedSeqRef 记录最近播放的 seq,防止 React 重渲染或
 * StrictMode 双触发导致重复发声。回放 prev(回退)后再次 next 前进时仍会重放,
 * 因为 seq 与上次不同。
 */
export function useSoundPlayback(current: QueuedEvent | null | undefined): void {
  const lastPlayedSeqRef = useRef<number>(-1);

  useEffect(() => {
    if (!current) return;
    const sound = extractSound(current.event);
    if (!sound) return;
    if (current.seq === lastPlayedSeqRef.current) return;
    lastPlayedSeqRef.current = current.seq;
    audioEngine.play(sound.sound, sound.volume);
  }, [current]);
}
