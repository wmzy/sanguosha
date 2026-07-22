// src/client/hooks/useCardMoveAnimation.ts
// 卡牌移动飞行动画 hook。
//
// 监听 useEventPlayback 的 ingestedEvents(每批新鲜 ViewEvent),识别卡牌移动类事件,
// 调用 cardMoveAnimation.flyCards 生成浮动飞牌动画。
//
// 覆盖的事件类型(前端从现有 ViewEvent 推断,不改引擎):
//   摸牌        牌堆 → 玩家座位     摸牌阶段 / 无中生有 / 遗计等
//   获得(from)   来源座位 → 目标座位  仁德 / 好施 / 顺手牵羊 / 突袭
//   弃置        玩家座位 → 弃牌堆    弃牌阶段 / 过河拆桥
//   移出至暂存区  玩家座位 → 屏幕外    破军 / 谦逊
//   归还暂存牌   屏幕外 → 玩家座位    破军归还 / 谦逊归还
//
// 信息分级:事件是否携带牌面(cards/cardName)决定明牌或扣置。
//   - 当前视角能看到牌面(owner 视角) → 明牌
//   - 仅看到 count(他人视角)        → 扣置牌背
//
// 去重:按 seq 跟踪已处理事件,避免 React strict mode 双触发或重放导致重复动画。

import { useEffect, useRef } from 'react';
import type { GameView, ViewEvent, Card } from '../../engine/types';
import type { QueuedEvent } from './useEventPlayback';
import { flyCards, type AnchorTarget, type FlyCardFace } from '../utils/cardMoveAnimation';

/** 已处理 seq 集合上限,超过则清空重建(防止无限增长) */
const MAX_TRACKED = 300;

/** 从 cardMap 查找完整牌面;找不到返回 null(渲染扣置) */
function lookupFace(view: GameView, cardId: string): FlyCardFace | null {
  const c: Card | undefined = view.cardMap[cardId];
  if (!c) return null;
  return { name: c.name, suit: c.suit, rank: c.rank };
}

function seat(index: number): AnchorTarget {
  return { kind: 'seat', index };
}

/**
 * 把单个 ViewEvent 映射为零或多个飞牌动画。
 * 返回 true 表示已消费该事件(触发了动画)。
 */
function triggerForEvent(event: ViewEvent, view: GameView): boolean {
  const type = event.atomType ?? event.type;

  switch (type) {
    case '摸牌': {
      const player = event.player as number;
      const cards = event.cards as Array<{ name: string; suit?: string; rank?: string }> | undefined;
      const count = (event.count as number) ?? cards?.length ?? 1;
      // 明牌:事件携带 cards 数组(当前视角摸牌);否则扣置
      const faces: (FlyCardFace | null)[] = cards
        ? cards.map((c) => ({
            name: c.name,
            suit: c.suit ?? '',
            rank: c.rank ?? '',
          }))
        : new Array(count).fill(null);
      flyCards({ kind: 'deck' }, seat(player), faces, count);
      return true;
    }

    case '获得': {
      const player = event.player as number;
      const from = event.from as number | undefined;
      const cardId = event.cardId as string | undefined;
      // 明牌:有 cardId 且 cardMap 能查到完整牌面
      const face = cardId ? lookupFace(view, cardId) : null;
      if (from !== undefined) {
        // 玩家间转移:仁德/好施/顺手牵羊/突袭
        flyCards(seat(from), seat(player), [face], 1);
      } else {
        // 无明确来源(从牌堆/处理区获得):视为牌堆→玩家
        flyCards({ kind: 'deck' }, seat(player), [face], 1);
      }
      return true;
    }

    case '弃置': {
      const player = event.player as number;
      const cardIds = (event.cardIds as string[]) ?? [];
      // 弃牌堆公开:尽量用 cardMap 查完整牌面;查不到的用 cardNames 降级
      const cardNames = event.cardNames as string[] | undefined;
      const faces: (FlyCardFace | null)[] = cardIds.map((id, i) => {
        const f = lookupFace(view, id);
        if (f) return f;
        if (cardNames && cardNames[i]) return { name: cardNames[i], suit: '', rank: '' };
        return null;
      });
      flyCards(seat(player), { kind: 'discard' }, faces, cardIds.length);
      return true;
    }

    case '移出至暂存区': {
      // 破军/谦逊:从 target 座位移出游戏
      const target = event.target as number;
      const cards = event.cards as Array<{ id: string; name: string; suit: string; rank: string }> | undefined;
      if (cards && cards.length > 0) {
        // source/target 视角:看到牌面
        const faces = cards.map((c) => ({ name: c.name, suit: c.suit, rank: c.rank }));
        flyCards(seat(target), { kind: 'offscreen' }, faces, faces.length);
      } else {
        // 其他人视角:只见数量,扣置
        const handCount = (event.handCount as number) ?? 0;
        const equipCount = ((event.equipEntries as unknown[]) ?? []).length;
        const count = handCount + equipCount;
        if (count > 0) {
          flyCards(seat(target), { kind: 'offscreen' }, [], count);
        }
      }
      return true;
    }

    case '归还暂存牌': {
      const player = event.player as number;
      const cards = event.cards as Array<{ name: string; suit: string; rank: string }> | undefined;
      const toDiscard = event.toDiscard === true;
      const dest: AnchorTarget = toDiscard ? { kind: 'discard' } : seat(player);
      if (cards && cards.length > 0) {
        const faces = cards.map((c) => ({ name: c.name, suit: c.suit, rank: c.rank }));
        flyCards({ kind: 'offscreen' }, dest, faces, faces.length);
      } else {
        const count = (event.count as number) ?? 1;
        flyCards({ kind: 'offscreen' }, dest, [], count);
      }
      return true;
    }

    default:
      return false;
  }
}

/**
 * 卡牌移动动画 hook。
 *
 * @param events  useEventPlayback 的 ingested(每批新鲜事件)
 * @param view    当前游戏视图(用于查 cardMap 补全牌面)
 */
export function useCardMoveAnimation(events: QueuedEvent[], view: GameView): void {
  const processedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const fresh = events.filter((e) => !processedRef.current.has(e.seq));
    if (fresh.length === 0) return;

    // 标记已处理
    const set = processedRef.current;
    for (const e of fresh) set.add(e.seq);
    // 超限清理:保留最近一半
    if (set.size > MAX_TRACKED) {
      const sorted = [...set].sort((a, b) => a - b);
      processedRef.current = new Set(sorted.slice(Math.floor(sorted.length / 2)));
    }

    // 延迟到下一帧:确保 DOM 锚点(座位/牌堆)已渲染到最新位置
    const raf = requestAnimationFrame(() => {
      for (const { event } of fresh) {
        triggerForEvent(event, view);
      }
    });
    return () => cancelAnimationFrame(raf);
    // view 引用每次渲染变化,但 fresh 事件由 events 数组引用驱动;
    // 这里只在 events 变化时触发(view 在 rAF 闭包中取最新传入值)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);
}
