import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';

export function register() {
  registerAtom({
    type: '整理牌堆',
    apply(state: GameState, atom: Atom & { type: '整理牌堆' }): GameState {
      const topCardIds = atom.topCardIds as string[];
      const bottomCardIds = atom.bottomCardIds as string[];

      // 收集所有需要重排的牌
      const rearrangingSet = new Set([...topCardIds, ...bottomCardIds]);

      // 从牌堆中移除这些牌
      const remainingDeck = state.zones.deck.filter(id => !rearrangingSet.has(id));

      // 新牌堆：topCardIds（牌堆顶）+ 剩余牌 + bottomCardIds（牌堆底）
      const newDeck = [...topCardIds, ...remainingDeck, ...bottomCardIds];

      return { ...state, zones: { ...state.zones, deck: newDeck } };
    },
  });
}
