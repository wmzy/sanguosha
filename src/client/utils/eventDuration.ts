// src/client/utils/eventDuration.ts
// ViewEvent 播放时长的单一取值来源,useEventPlayback(实时横幅队列)与
// useReplay(回放自动播放)共用:
// 1. ViewEvent 自带 effect.duration(派生事件如「打出」)
// 2. atom 静态 effect.duration(查 atomType 优先——打出/弃牌 等 ViewEvent.type
//    不是 atom 名,且查表失败不能抛)
// 3. 兜底 FALLBACK_DURATION_MS

import type { ViewEvent } from '../../engine/types';
import { getAtomDef } from '../../engine/core/atom';

/** 事件最小可见时长(ms),保证事件能被看清,即便 effect.duration 偏短 */
export const MIN_VISIBLE_MS = 400;

/** duration 缺失时的回退间隔(ms) */
export const FALLBACK_DURATION_MS = 400;

/** 取某 ViewEvent 的基础播放时长(ms)。不含箭头加成/速度系数,由调用方自行叠加。 */
export function computeEventDuration(event: ViewEvent): number {
  const type = event.atomType ?? event.type;
  let staticDuration: number | undefined;
  try {
    staticDuration = getAtomDef(type).effect?.duration;
  } catch {
    staticDuration = undefined;
  }
  const eventEffect = event.effect as { duration?: number } | undefined;
  return eventEffect?.duration ?? staticDuration ?? FALLBACK_DURATION_MS;
}
