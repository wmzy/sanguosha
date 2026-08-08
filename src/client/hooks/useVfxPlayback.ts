// src/client/hooks/useVfxPlayback.ts
// Lottie 特效播放 hook：监听 useEventPlayback.ingested，按 effect.vfx 播放。
//
// effect.vfx 是 Lottie 资源 ID（如 'skill_奸雄'），查 resourceManager.get('anim/' + id)。
// 缺失资源静默跳过。
//
// 与 useSoundPlayback 同构：监听 ingested 批次（立即触发，不等延时播放队列），
// 用 ref 记录已处理的最大 seq 过滤重复（seq 单调递增）。
//
// 关键：返回值为 React state（useState），而非 ref。原 plan 用 queueRef 累积项目，
// 但 ref 不触发 re-render，导致 VfxLayer 永远收不到新 items。这里改用 useState，
// 新批次到来时 setState 推送 VfxPlaybackItem[]，驱动 VfxLayer 重新渲染。

import { useEffect, useRef, useState } from 'react';
import type { ViewEvent, Card } from '../../engine/types';
import { getAtomDef } from '../../engine/core/atom';
import { resourceManager } from '../resources';
import { getCardVfx } from '../cardVfx';
import type { QueuedEvent } from './useEventPlayback';

/** ViewEvent 自带的 effect 片段（派生事件携带；静态 atom 走 getAtomDef） */
type EventEffect = { vfx?: string } | undefined;

/**
 * 从 ViewEvent 提取 effect.vfx。
 * 优先用 ViewEvent 自带 effect（派生事件），fallback 到 atom 静态 effect。
 *  查表失败（未注册 type）返回 null，不抛。
 *
 * 「使用时」事件的出牌动效由前端按 cardName + damageType 自行计算
 *  (getCardVfx),引擎不再在 effect 中硬编码 vfx。
 */
function extractVfx(event: ViewEvent, cardMap: Record<string, Card>): string | null {
  if (event.type === '使用时') {
    const ev = event as { cardName?: string; cardId?: string };
    const cardName = ev.cardName;
    if (!cardName) return null;
    const damageType = ev.cardId ? cardMap[ev.cardId]?.damageType : undefined;
    return getCardVfx(cardName, damageType);
  }
  const atomType = (event as { atomType?: string }).atomType ?? event.type;
  let staticEffect: EventEffect;
  try {
    staticEffect = getAtomDef(atomType).effect;
  } catch {
    staticEffect = undefined;
  }
  const effect = (event.effect as EventEffect) ?? staticEffect;
  return effect?.vfx ?? null;
}

export interface VfxPlaybackItem {
  /** 唯一 key（seq-vfxId），供 VfxLayer 列表渲染与回收 */
  key: string;
  /** Lottie JSON 的 URL（resourceManager.get 返回） */
  url: string;
  /** 目标玩家座次。有目标动效(如伤害)定位到对应武将卡上播放;undefined=居中。 */
  target?: number;
}

/**
 * Lottie 特效播放 hook。
 *
 * @param ingested  useEventPlayback 的 ingested（每批新鲜事件）。
 *                  为 undefined/null/空数组时无副作用。
 * @returns 待播放的特效项目列表（每次有新 vfx 时追加，由 VfxLayer 渲染并在播完后由其自行回收）。
 */
export function useVfxPlayback(
  ingested: readonly QueuedEvent[] | null | undefined,
  cardMap: Record<string, Card>,
): VfxPlaybackItem[] {
  const lastSeqRef = useRef(0);
  const [items, setItems] = useState<VfxPlaybackItem[]>([]);

  useEffect(() => {
    if (!ingested || ingested.length === 0) return;
    // 过滤已处理的 seq（seq 单调递增，只需跟踪最大值）
    const fresh = ingested.filter((e) => e.seq > lastSeqRef.current);
    if (fresh.length === 0) return;
    lastSeqRef.current = Math.max(...fresh.map((e) => e.seq));

    const newItems: VfxPlaybackItem[] = [];
    for (const { event, seq } of fresh) {
      const vfxId = extractVfx(event, cardMap);
      if (!vfxId) continue;
      const url = resourceManager.get(`anim/${vfxId}`);
      if (!url) continue;
      // 提取目标座次,优先级:target(伤害等) > player(自效型/判定) > source(使用牌)。
      // 使用时/打出牌时 事件只携带 source(使用者):桃/酒 selfTarget,使用者即目标,
      // 回退到 source 让牌的特效定位到使用者武将卡,而非居屏幕中央。
      const ev = event as { target?: unknown; player?: unknown; source?: unknown };
      const asNum = (v: unknown): number | undefined =>
        typeof v === 'number' && Number.isFinite(v) ? v : undefined;
      const target = asNum(ev.target) ?? asNum(ev.player) ?? asNum(ev.source);
      newItems.push({ key: `${seq}-${vfxId}`, url, target });
    }
    if (newItems.length > 0) {
      setItems((prev) => [...prev, ...newItems]);
    }
    // cardMap 引用每次渲染变化,但 fresh 事件由 ingested 数组引用驱动;
    // 这里只在 ingested 变化时触发(cardMap 在闭包中取最新传入值)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingested]);

  return items;
}
