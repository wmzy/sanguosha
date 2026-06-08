import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';

/**
 * giveCard: 玩家间给牌（手牌 → 另一玩家手牌）。
 * 不校验 from/to 是否存在；从语义上 from 的手牌里移除 cardId，并追加到 to 手牌。
 */
export function register() {
  registerAtom({
    type: '给予',
    apply(state: GameState, atom: Atom & { type: '给予' }): GameState {
      const cardId = atom.cardId as string;
      const from = atom.from as string;
      const to = atom.to as string;
      return updatePlayer(
        updatePlayer(state, from, p => ({ hand: p.hand.filter(id => id !== cardId) })),
        to,
        p => ({ hand: [...p.hand, cardId] }),
      );
    },
  });
}
