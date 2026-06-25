// src/client/hooks/useProcessingPicks.ts
// 五谷丰登选牌展示增强(纯渲染层,不改引擎契约)。
//
// 问题:引擎给每个选牌者弹的 pickProcessingCard pending 只含「仍在处理区的牌」,
// 被选走的牌从 processing 消失,后续选牌者看不到它被谁选走。
//
// 方案:渲染层通过对 view 状态的快照 diff 累积一份「被选记录」。
//   - 五谷丰登选牌流程中,两次 render 之间的唯一状态变化就是一次「处理区→手牌」的移动:
//     某张牌从 view.zones.processing 消失,某玩家 view.players[i].handCount +1。
//   - 相关性可靠:不会和其他操作混淆(出牌阶段才出牌,五谷丰登在摸牌阶段后立即结算)。
//   - 全量候选 = 当前 pending.cards ∪ 已被选走的牌(从 diff 累积)。
//     被选牌的卡牌信息从 view.cardMap 查得(buildView 返回全量 cardMap)。
//   - 处理区清空(五谷丰登结算结束)时重置。
//
// 之所以不用 currentEvent(事件回放):回放是延时播放的(setTimeout 驱动,最小 400ms),
// 而 view 状态是即时突变的。依赖延时事件会导致 P2 首次渲染时 pickedCardIdsRef 为空,
// 被选牌延迟数百毫秒后才闪现。
import { useRef, useMemo } from 'react';
import type { GameView, Card } from '../../engine/types';

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

/** 从 view.cardMap 查卡牌信息(buildView 返回全量 cardMap,被选走的牌仍在其中) */
function cardFromMap(view: GameView, cardId: string): ProcessingPickCard | null {
  const c = view.cardMap[cardId];
  if (!c) return null;
  return { cardId, cardName: c.name, suit: c.suit, rank: c.rank };
}

/**
 * 累积五谷丰登选牌的展示状态。
 *
 * 通过对 view 快照的 diff 推导被选走的牌(而非依赖延时事件回放):
 *  - processing 中消失的 cardId = 被选走
 *  - handCount 增加的玩家 = 选牌者
 *
 * @param view 当前视角的 GameView
 * @returns 选牌展示状态;无活跃的 pickProcessingCard pending 时返回 null
 */
export function useProcessingPicks(view: GameView): ProcessingPickState | null {
  // 持久累积,避免每次 render 重置
  const pickedByRef = useRef<Map<string, string>>(new Map());
  // 已被选走的牌 cardId 列表(按选牌顺序),用于重建全量候选
  const pickedCardIdsRef = useRef<string[]>([]);
  // 上一 render 的 processing 快照(cardId 数组)
  const prevProcessingRef = useRef<string[] | null>(null);
  // 上一 render 的各玩家 handCount 快照
  const prevHandCountsRef = useRef<number[] | null>(null);
  // 会话活跃标志:从首次进入 pickProcessingCard 到 processing 清空之间持续追踪
  const activeRef = useRef<boolean>(false);

  return useMemo(() => {
    const pending = view.pending;
    const isPickPending = pending?.prompt?.type === 'pickProcessingCard';
    const processing = view.zones?.processing ?? [];
    const handCounts = view.players.map(p => p.handCount);

    // 1. 首次进入选牌:激活追踪
    if (isPickPending && !activeRef.current) {
      activeRef.current = true;
    }

    // 2. 选牌结束(不活跃或处理区清空)→ 重置
    const processingEmpty = processing.length === 0;
    if (!isPickPending && processingEmpty) {
      pickedByRef.current = new Map();
      pickedCardIdsRef.current = [];
      prevProcessingRef.current = processing;
      prevHandCountsRef.current = handCounts;
      activeRef.current = false;
      return null;
    }

    // 3. 快照 diff:累积被选走的牌
    //    仅在会话活跃时追踪(避免误捕捉非选牌阶段的 processing 变化)
    if (activeRef.current && prevProcessingRef.current && prevHandCountsRef.current) {
      const prevSet = new Set(prevProcessingRef.current);
      // processing 中消失的牌 = 被选走
      const removed = processing.filter(id => !prevSet.has(id));
      // 反过来:prevProcessing 中有但当前 processing 没有的
      const curSet = new Set(processing);
      const pickedNow = prevProcessingRef.current.filter(id => !curSet.has(id));

      if (pickedNow.length > 0) {
        // 找 handCount 增加的玩家(按增量排序,增量最大的优先匹配)
        const deltas: { player: number; delta: number }[] = [];
        for (let i = 0; i < handCounts.length; i++) {
          const prev = prevHandCountsRef.current[i] ?? 0;
          const cur = handCounts[i] ?? 0;
          if (cur > prev) deltas.push({ player: i, delta: cur - prev });
        }
        // 按增量降序排列后依次消费
        deltas.sort((a, b) => b.delta - a.delta);
        for (let k = 0; k < pickedNow.length && k < deltas.length; k++) {
          const cardId = pickedNow[k];
          const playerName = view.players[deltas[k].player]?.name ?? `P${deltas[k].player}`;
          pickedByRef.current.set(cardId, playerName);
          if (!pickedCardIdsRef.current.includes(cardId)) {
            pickedCardIdsRef.current.push(cardId);
          }
        }
      }
      // removed(processing 中新增的牌,如翻新出的判定牌)不在追踪范围内,忽略
      void removed;
    }

    // 4. 更新快照
    prevProcessingRef.current = processing;
    prevHandCountsRef.current = handCounts;

    if (!isPickPending) return null;

    // 5. 全量候选 = 已被选走的牌(从 diff 累积) ∪ 当前 pending.cards(仍在处理区的)
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
  }, [view.pending, view.zones?.processing, view.cardMap, view.players]);
}
