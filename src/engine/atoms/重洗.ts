// src/engine/atoms/重洗.ts
// 重洗:合并当前牌堆与弃牌堆,重新洗成新牌堆,弃牌堆清空。
// 当牌堆耗尽时由 摸牌 atom 内部触发;也可作为独立 atom 使用。
// 用 state.rngSeed 派生 RNG(推进后写回),保证重放确定性。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { createRng } from '../../shared/rng';

export const 重洗: AtomDefinition<Record<string, never>> = {
  type: '重洗',
  validate(state) {
    if (state.zones.discardPile.length === 0) return 'discardPile is empty';
    return null;
  },
  apply(state) {
    const combined = [...state.zones.deck, ...state.zones.discardPile];
    const rng = createRng(state.rngSeed);
    for (let i = combined.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }
    state.zones.deck = combined;
    state.zones.discardPile = [];
    state.rngSeed = rng.getState();
  },
  effect: { sound: 'shuffle', animation: 'flip', duration: 400 },
  toViewEvents(state): ViewEventSplit {
    // toViewEvents 在 apply 之前调用,此时 deck+discardPile 尚未合并。
    // totalCards = 重洗后的新牌堆张数(deck 与 discardPile 合并去重后的总数)。
    const event: ViewEvent = { type: '重洗', totalCards: state.zones.deck.length + state.zones.discardPile.length };
    return { ownerViews: new Map(), othersView: event };
  },
};

registerAtom(重洗);
