// src/engine/skills/_delayedTrickTransform.ts — 延时锦囊转化技(独立 use 模型)的
// 放置序列共享实现。
//
// 断粮/界断粮(黑色牌→兵粮寸断)、国色(方块牌→乐不思蜀)、界国色(方片牌→乐不思蜀)
// 同构,统一序列:
//   [allowEquipment 且牌在装备区 → 先 卸下(装备区→手牌,产生 ViewEvent+清武器距离 vars)]
//   → 移动牌(手牌→处理区,打出) → 添加延时锦囊(cardMap[cardId] ?? fallback 牌面)
//   → 移动牌(处理区→弃牌堆)。
//
// 为何独立 use 而非 transform+影子卡(详见 国色.ts 头注):延时锦囊把 trick.card.id
// 持久存入目标 pendingTricks,影子卡入弃牌堆时被引擎还原并 delete 后 view.cardMap
// 查无此卡,前端无法渲染判定区——原卡 id 必须永驻 cardMap。
// 判定/跳过阶段/无懈可击抵消的效果由 乐不思蜀.ts / 兵粮寸断.ts 的 hooks 处理
// (它们只认 trick.name,与转化来源无关)。
import type { Card, EquipSlot, GameState } from '../types';
import { applyAtom } from '../core/apply';

/** 延时锦囊转化放置参数。 */
export interface PlaceDelayedTrickOptions {
  /** 使用者座次(延时锦囊 source) */
  from: number;
  /** 目标座次(延时锦囊放置到其判定区) */
  target: number;
  cardId: string;
  /** 延时锦囊名('乐不思蜀'/'兵粮寸断') */
  trickName: string;
  /** cardMap 缺卡时的 fallback 牌面(suit/color/rank) */
  fallback: Pick<Card, 'suit' | 'color' | 'rank'>;
  /** 牌可在装备区:先 卸下 到手牌再打出(国色/界国色;断粮仅手牌,缺省关闭) */
  allowEquipment?: boolean;
}

/** 延时锦囊转化技的统一放置序列:
 *  [装备区先卸下] → 打出进处理区 → 添加延时锦囊 → 使用卡进弃牌堆。 */
export async function placeDelayedTrickTransform(
  state: GameState,
  opts: PlaceDelayedTrickOptions,
): Promise<void> {
  const { from, target, cardId, trickName, fallback } = opts;

  // 装备区的牌:先卸下到手牌(产生 ViewEvent,清除武器距离 vars),再走标准打出流程
  if (opts.allowEquipment) {
    const equipSlotEntry = Object.entries(state.players[from].equipment).find(
      ([, id]) => id === cardId,
    );
    if (equipSlotEntry) {
      await applyAtom(state, {
        type: '卸下',
        player: from,
        slot: equipSlotEntry[0] as EquipSlot,
      });
    }
  }

  // 卡牌进处理区(打出)
  await applyAtom(state, {
    type: '移动牌',
    cardId,
    from: { zone: '手牌', player: from },
    to: { zone: '处理区' },
  });

  // 放置延时锦囊:复用现有延时锦囊 hooks(判定/跳过阶段,只认 trick.name)
  const trickCard: Card = state.cardMap[cardId] ?? {
    id: cardId,
    name: trickName,
    suit: fallback.suit,
    color: fallback.color,
    rank: fallback.rank,
    type: '锦囊牌',
  };
  await applyAtom(state, {
    type: '添加延时锦囊',
    player: target,
    trick: { name: trickName, source: from, card: trickCard },
  });

  // 使用卡进弃牌堆
  await applyAtom(state, {
    type: '移动牌',
    cardId,
    from: { zone: '处理区' },
    to: { zone: '弃牌堆' },
  });
}
