// @ts-nocheck
import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';

/**
 * takeCard: 从牌堆取一张牌到指定玩家的手牌。
 * 若牌堆中不存在 cardId，则牌堆保持不变（仍追加给目标手牌）。
 */
export function register() {
  registerAtom({
    type: '抽牌',
    apply(state: GameState, atom: Atom & { type: '抽牌' }): GameState {
      const cardId = atom.cardId as string;
      const to = atom.to as string;
      const remaining = state.zones.deck.filter(id => id !== cardId);
      return updatePlayer(
        { ...state, zones: { ...state.zones, deck: remaining } },
        to,
        p => ({ hand: [...p.hand, cardId] }),
      );
    },
  });
}
