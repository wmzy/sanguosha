// src/engine/atoms/整理牌堆.ts
// 整理牌堆:用给定顺序替换牌堆(用于观星等技能)
//
// 视图通信:牌堆数量不变(applyView 不改 zones),但排列事件是公开信息——
// 其他玩家应看到"X 张放牌堆顶,Y 张放牌堆底"。具体牌内容不广播(只对操作者可见)。
// topCount/bottomCount 由调用方(观星)传入,反映操作者选择的划分。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 整理牌堆: AtomDefinition<{
  cards: string[];
  /** 置于牌堆顶的张数(供前端展示"X张放牌堆顶") */
  topCount?: number;
  /** 置于牌堆底的张数(供前端展示"Y张放牌堆底") */
  bottomCount?: number;
}> = {
  type: '整理牌堆',
  validate(state, atom) {
    const deckSet = new Set(state.zones.deck);
    if (atom.cards.length !== state.zones.deck.length) return 'card count mismatch';
    for (const id of atom.cards) {
      if (!deckSet.has(id)) return `card ${id} not in deck`;
    }
    return null;
  },
  apply(state, atom) {
    state.zones.deck = [...atom.cards];
  },
  effect: { sound: 'card_place', animation: 'flip', duration: 600 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '整理牌堆',
      topCount: atom.topCount ?? 0,
      bottomCount: atom.bottomCount ?? 0,
    };
    // 排列信息是公开的:所有玩家看到相同数据(不含具体牌)
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 牌堆数量不变,无需更新 zones
  },
  toViewLog(event) {
    const top = (event.topCount as number) ?? 0;
    const bottom = (event.bottomCount as number) ?? 0;
    const parts: string[] = [];
    if (top > 0) parts.push(`${top}张放牌堆顶`);
    if (bottom > 0) parts.push(`${bottom}张放牌堆底`);
    if (parts.length === 0) return null;
    return { player: -1, text: `整理牌堆:${parts.join(',')}` };
  },
};

registerAtom(整理牌堆);
