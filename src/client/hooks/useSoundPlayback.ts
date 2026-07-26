// src/client/hooks/useSoundPlayback.ts
// 音效播放 hook:监听 useEventPlayback 的 ingested 事件批次,
// 按 AtomEffect.sound 标识符查表播放对应音效。
//
// 挂载时机说明:
//   音效应在事件"到达"时立即响,而非"延时展示时"。
//   useEventPlayback 暴露:
//     - current:延时播放中的事件(逐个出队,翻牌声会在牌翻完才响,违和)
//     - ingested:最近入队的新鲜事件批次(立即触发,每个事件播一次)
//   因此本 hook 监听 ingested,而非 current。
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
 * 音效播放 hook。
 *
 * @param ingested  useEventPlayback 的 ingested(每批新鲜事件)。
 *                  为 undefined/null/空数组时无副作用。
 *
 * 每个 seq 只播一次:用 ref 记录已处理的最大 seq,过滤重复(与 usePlayHistory 同构)。
 */
export function useSoundPlayback(ingested: readonly QueuedEvent[] | null | undefined): void {
  const lastSeqRef = useRef(0);

  useEffect(() => {
    if (!ingested || ingested.length === 0) return;
    // 过滤已处理的 seq(seq 单调递增,只需跟踪最大值)
    const fresh = ingested.filter((e) => e.seq > lastSeqRef.current);
    if (fresh.length === 0) return;
    lastSeqRef.current = Math.max(...fresh.map((e) => e.seq));

    for (const { event } of fresh) {
      const sound = extractSound(event);
      if (sound) {
        audioEngine.play(sound.sound, sound.volume);
      }
    }
  }, [ingested]);
}
