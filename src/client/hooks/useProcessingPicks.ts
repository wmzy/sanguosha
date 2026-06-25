// src/client/hooks/useProcessingPicks.ts
// 五谷丰登选牌展示增强(读取引擎结算帧数据)。
//
// 数据来源(全部通过 atom 同步,前端即时可见):
//   - 帧的 cards: 候选牌(移动牌 atom 同步),被选走的牌会从 cards 移除
//   - params.revealedIds: 全量亮出牌(帧参数赋值 atom 同步),用于展示被选牌
//   - params.pickedBy: {cardId→选牌者} 映射(帧参数赋值 atom 同步)
//
// 全量候选 = revealedIds(亮出的牌,含已选走的),被选牌从 pickedBy 标注为禁用。
import { useMemo } from 'react';
import type { GameView, Card, Json } from '../../engine/types';

export interface ProcessingPickCard {
  cardId: string;
  cardName: string;
  suit: Card['suit'];
  rank: string;
}

export interface ProcessingPickState {
  /** 全量候选牌(亮出的牌,含已选走的) */
  allCards: ProcessingPickCard[];
  /** 被选走的牌:cardId → 选牌者名称 */
  pickedBy: Map<string, string>;
}

/** 从 view.cardMap 查卡牌信息 */
function cardFromMap(view: GameView, cardId: string): ProcessingPickCard | null {
  const c = view.cardMap[cardId];
  if (!c) return null;
  return { cardId, cardName: c.name, suit: c.suit, rank: c.rank };
}

/**
 * 从 view.settlementStack 读取五谷丰登选牌状态。
 */
export function useProcessingPicks(view: GameView): ProcessingPickState | null {
  return useMemo(() => {
    const pending = view.pending;
    const isPickPending = pending?.prompt?.type === 'pickProcessingCard';
    if (!isPickPending) return null;

    const wuguFrame = view.settlementStack.find(f => f.skillId === '五谷丰登');
    if (!wuguFrame) return null;

    // 全量候选:优先用 params.revealedIds(含已选走的牌),回退到帧 cards(当前剩余)
    const revealedIds = (wuguFrame.params.revealedIds as string[] | undefined);
    const pickedByRaw = (wuguFrame.params.pickedBy as Record<string, Json> | undefined) ?? {};
    const pickedBy = new Map<string, string>();
    for (const [cardId, name] of Object.entries(pickedByRaw)) {
      if (typeof name === 'string') pickedBy.set(cardId, name);
    }

    const allCards: ProcessingPickCard[] = [];
    if (revealedIds && revealedIds.length > 0) {
      // revealedIds 已同步:全量候选(含被选牌)
      for (const cardId of revealedIds) {
        const c = cardFromMap(view, cardId);
        if (c) allCards.push(c);
      }
    } else {
      // revealedIds 未到(亮牌事件还在队列):回退到帧 cards(当前处理区剩余)
      for (const cardId of wuguFrame.cards) {
        const c = cardFromMap(view, cardId);
        if (c) allCards.push(c);
      }
    }

    return { allCards, pickedBy };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
}
