// src/client/hooks/useProcessingPicks.ts
// 五谷丰登选牌展示增强(纯渲染层读取引擎权威数据)。
//
// 引擎在五谷丰登技能的结算帧 params 里维护:
//   - revealedIds: 亮出的牌(牌堆顶翻出的 N 张)
//   - pickedBy: { cardId → 选牌者名称 } 的映射
// 这些通过「结算帧入栈」atom 同步到 view.settlementStack,前端直接读取。
//
// 全量候选 = revealedIds(亮出的牌) ∩ cardMap 可查的牌。
// 被选走的牌(在 pickedBy 中)渲染为禁用并标注选牌者。
import { useMemo } from 'react';
import type { GameView, Card, Json } from '../../engine/types';

export interface ProcessingPickCard {
  cardId: string;
  cardName: string;
  suit: Card['suit'];
  rank: string;
}

export interface ProcessingPickState {
  /** 全量候选牌(亮出的牌,按亮牌顺序) */
  allCards: ProcessingPickCard[];
  /** 被选走的牌:cardId → 选牌者名称 */
  pickedBy: Map<string, string>;
}

/** 从 view.cardMap 查卡牌信息(buildView 返回全量 cardMap,被选走的牌仍在其中) */
function cardFromMap(view: GameView, cardId: string): ProcessingPickCard | null {
  const c = view.cardMap[cardId];
  if (!c) return null;
  return { cardId, cardName: c.name, suit: c.suit, rank: c.rank };
}

/**
 * 从 view.settlementStack 读取五谷丰登选牌状态。
 *
 * 引擎通过「结算帧入栈」atom 同步 settlementStack,帧 params 含
 * revealedIds(亮出牌)和 pickedBy(被选映射)。前端即时读取,不依赖延时事件回放。
 */
export function useProcessingPicks(view: GameView): ProcessingPickState | null {
  return useMemo(() => {
    const pending = view.pending;
    const isPickPending = pending?.prompt?.type === 'pickProcessingCard';
    if (!isPickPending) return null;

    // 从结算帧栈查找五谷丰登帧(可能在非栈顶——嵌套结算时)
    const wuguFrame = view.settlementStack.find(
      f => f.skillId === '五谷丰登',
    );
    if (!wuguFrame) return null;

    const revealedIds = (wuguFrame.params.revealedIds as string[] | undefined) ?? [];
    const pickedByRaw = (wuguFrame.params.pickedBy as Record<string, Json> | undefined) ?? {};
    const pickedBy = new Map<string, string>();
    for (const [cardId, name] of Object.entries(pickedByRaw)) {
      if (typeof name === 'string') pickedBy.set(cardId, name);
    }

    // 全量候选 = 亮出的牌(revealedIds 顺序 = 亮牌顺序)
    const allCards: ProcessingPickCard[] = [];
    for (const cardId of revealedIds) {
      const c = cardFromMap(view, cardId);
      if (c) allCards.push(c);
    }

    return { allCards, pickedBy };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
}
