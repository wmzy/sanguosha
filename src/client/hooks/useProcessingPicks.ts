// src/client/hooks/useProcessingPicks.ts
// 五谷丰登选牌展示增强(纯渲染层,不改引擎契约)。
//
// 问题:引擎给每个选牌者弹的 pickProcessingCard pending 只含「仍在处理区的牌」,
// 被选走的牌从 processing 消失,后续选牌者看不到它被谁选走。
//
// 方案:渲染层订阅已到达的公开「移动牌」事件,自己累积一份「被选记录」。
//   - 移动牌(from:处理区, to:手牌) 是公开事件,to.player 就是选牌者。
//   - 全量候选 = 当前 pending.cards ∪ 已被选走的牌(从事件流累积)。
//     被选牌的卡牌信息从 view.cardMap 查得(buildView 返回全量 cardMap)。
//   - 处理区清空(五谷丰登结算结束)时重置。
//
// 与判定牌在 useDebugMultiConnection 里临时加入 processing 展示同一性质——
// 纯前端展示增强,不碰引擎 applyView/buildView 契约。
import { useRef, useMemo } from 'react';
import type { GameView, ViewEvent, Card } from '../../engine/types';
import type { QueuedEvent } from './useEventPlayback';

export interface ProcessingPickCard {
  cardId: string;
  cardName: string;
  suit: Card['suit'];
  rank: string;
}

export interface ProcessingPickState {
  /** 全量候选牌(当前 pending.cards ∪ 已被选走的牌,按亮牌顺序) */
  allCards: ProcessingPickCard[];
  /** 被选走的牌:cardId → 选牌者名称 */
  pickedBy: Map<string, string>;
}

/** 判断事件是否为「处理区→手牌」的移动牌(五谷丰登选牌) */
function isProcessingPickEvent(event: ViewEvent): { cardId: string; player: number } | null {
  if (event.type !== '移动牌') return null;
  const from = event.from as { zone?: string } | undefined;
  const to = event.to as { zone?: string; player?: number } | undefined;
  if (from?.zone !== '处理区') return null;
  if (to?.zone !== '手牌') return null;
  if (typeof to.player !== 'number') return null;
  const cardId = event.cardId as string | undefined;
  if (typeof cardId !== 'string') return null;
  return { cardId, player: to.player };
}

/** 从 view.cardMap 查卡牌信息(buildView 返回全量 cardMap,被选走的牌仍在其中) */
function cardFromMap(view: GameView, cardId: string): ProcessingPickCard | null {
  const c = view.cardMap[cardId];
  if (!c) return null;
  return { cardId, cardName: c.name, suit: c.suit, rank: c.rank };
}

/**
 * 累积五谷丰登选牌的展示状态。
 *
 * @param currentEvent 当前播放的事件(来自 useEventPlayback)
 * @param view 当前视角的 GameView
 * @returns 选牌展示状态;无活跃的 pickProcessingCard pending 时返回 null
 */
export function useProcessingPicks(
  currentEvent: QueuedEvent | null | undefined,
  view: GameView,
): ProcessingPickState | null {
  // 持久累积,避免每次 render 重置
  const pickedByRef = useRef<Map<string, string>>(new Map());
  // 已被选走的牌 cardId 列表(按选牌顺序),用于重建全量候选
  const pickedCardIdsRef = useRef<string[]>([]);
  // 已处理过的事件 seq,避免重放重复记录
  const seenSeqsRef = useRef<Set<number>>(new Set());

  return useMemo(() => {
    const pending = view.pending;
    const isPickPending = pending?.prompt?.type === 'pickProcessingCard';

    // 1. 无活跃的 pickProcessingCard pending 且处理区已空 → 重置
    const processingEmpty = (view.zones?.processing ?? []).length === 0;
    if (!isPickPending && processingEmpty) {
      pickedByRef.current = new Map();
      pickedCardIdsRef.current = [];
      seenSeqsRef.current = new Set();
      return null;
    }

    if (!isPickPending) return null;

    // 2. 累积被选事件(从 currentEvent 读取)
    if (currentEvent && !seenSeqsRef.current.has(currentEvent.seq)) {
      seenSeqsRef.current.add(currentEvent.seq);
      const pick = isProcessingPickEvent(currentEvent.event);
      if (pick) {
        const pickerName = view.players[pick.player]?.name ?? `P${pick.player}`;
        pickedByRef.current.set(pick.cardId, pickerName);
        if (!pickedCardIdsRef.current.includes(pick.cardId)) {
          pickedCardIdsRef.current.push(pick.cardId);
        }
      }
    }

    // 3. 全量候选 = 已被选走的牌(从事件累积) ∪ 当前 pending.cards(仍在处理区的)
    //    被选牌在前(先亮先选),未选牌在后。去重。
    const pendingPrompt = pending?.prompt as { type: 'pickProcessingCard'; cards?: ProcessingPickCard[] };
    const pendingCards = pendingPrompt.cards ?? [];
    const seen = new Set<string>();
    const allCards: ProcessingPickCard[] = [];

    for (const cardId of pickedCardIdsRef.current) {
      if (seen.has(cardId)) continue;
      const c = cardFromMap(view, cardId);
      if (c) {
        seen.add(cardId);
        allCards.push(c);
      }
    }
    for (const c of pendingCards) {
      if (seen.has(c.cardId)) continue;
      seen.add(c.cardId);
      allCards.push(c);
    }

    return {
      allCards,
      pickedBy: pickedByRef.current,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view 是引用稳定的 prop,内部字段单独列依赖不实际
  }, [currentEvent, view.pending, view.zones?.processing, view.cardMap, view.players]);
}
