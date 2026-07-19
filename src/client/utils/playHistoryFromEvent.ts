// src/client/utils/playHistoryFromEvent.ts
// 从 ViewEvent 推导出牌历史条目(短标注与日志语义对齐)。

import type { GameView, ViewEvent } from '../../engine/types';
import type { PlayHistoryItem } from './playHistoryQueue';

function playerName(view: GameView, index: number): string {
  return view.players.find((p) => p.index === index)?.name ?? `P${index}`;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `ph-${Date.now()}-${seq}`;
}

export type PlayHistoryMutation =
  | { kind: 'push'; items: PlayHistoryItem[] }
  | { kind: 'caption'; cardId: string; caption: string }
  | null;

/**
 * 将单个 ViewEvent 转为历史队列变更。
 * - 打出 → 入队,标注「名」;响应牌(闪等无随后指定目标)保持「名出牌名」在后续可再改
 * - 弃牌 / 弃置 → 入队,标注「名弃」
 * - 指定目标 → 更新同 cardId 标注为「源→目标」
 */
export function playHistoryMutationFromEvent(
  event: ViewEvent,
  view: GameView,
  now = Date.now(),
): PlayHistoryMutation {
  const t = (event.type ?? (event as { atomType?: string }).atomType) as string | undefined;
  if (!t) return null;

  if (t === '打出') {
    const player = event.player as number | undefined;
    const card = event.card as { name?: string; suit?: string; rank?: string } | undefined;
    if (player === undefined || !card?.name) return null;
    const name = playerName(view, player);
    // 响应/无目标:「张角出闪」;有目标时指定目标事件会改成「源→目标」
    const caption = `${name}出${card.name}`;
    return {
      kind: 'push',
      items: [
        {
          id: nextId(),
          card: { name: card.name, suit: card.suit, rank: card.rank },
          caption,
          enqueuedAt: now,
          cardId: event.cardId as string | undefined,
        },
      ],
    };
  }

  if (t === '弃牌') {
    const player = event.player as number | undefined;
    const card = event.card as { name?: string; suit?: string; rank?: string } | undefined;
    if (player === undefined || !card?.name) return null;
    const name = playerName(view, player);
    return {
      kind: 'push',
      items: [
        {
          id: nextId(),
          card: { name: card.name, suit: card.suit, rank: card.rank },
          caption: `${name}弃`,
          enqueuedAt: now,
          cardId: event.cardId as string | undefined,
        },
      ],
    };
  }

  if (t === '弃置') {
    const player = event.player as number | undefined;
    if (player === undefined) return null;
    const name = playerName(view, player);
    const cardIds = (event.cardIds as string[] | undefined) ?? [];
    const cardNames = (event.cardNames as string[] | undefined) ?? [];
    const items: PlayHistoryItem[] = [];
    for (let i = 0; i < Math.max(cardIds.length, cardNames.length); i++) {
      const cardName = cardNames[i] ?? view.cardMap[cardIds[i] ?? '']?.name;
      if (!cardName) continue;
      const full = cardIds[i] ? view.cardMap[cardIds[i]] : undefined;
      items.push({
        id: nextId(),
        card: {
          name: cardName,
          suit: full?.suit,
          rank: full?.rank,
        },
        caption: `${name}弃`,
        enqueuedAt: now,
        cardId: cardIds[i],
      });
    }
    return items.length > 0 ? { kind: 'push', items } : null;
  }

  if (t === '指定目标' || t === '成为目标') {
    const source = event.source as number | undefined;
    const target = event.target as number | undefined;
    const cardId = event.cardId as string | undefined;
    if (source === undefined || target === undefined || !cardId) return null;
    const caption = `${playerName(view, source)}→${playerName(view, target)}`;
    return { kind: 'caption', cardId, caption };
  }

  return null;
}
