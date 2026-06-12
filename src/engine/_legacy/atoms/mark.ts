// @ts-nocheck
import type { GameState, Atom, Json } from '../types';
import { registerAtom } from '../atom';
import { addMarkToPlayer, removeMarkFromPlayer, clearExpiredMarksByPhase } from '../mark';

export function register() {
  registerAtom({
    type: '加标记',
    apply(state: GameState, atom: Atom & { type: '加标记' }): GameState {
      const player = atom.player as string;
      return addMarkToPlayer(state, player, atom.mark);
    },
  });

  registerAtom({
    type: '去标记',
    apply(state: GameState, atom: Atom & { type: '去标记' }): GameState {
      const player = atom.player as string;
      return removeMarkFromPlayer(state, player, atom.markId);
    },
  });

  registerAtom({
    type: '清过期标记',
    apply(state: GameState, atom: Atom & { type: '清过期标记' }): GameState {
      return clearExpiredMarksByPhase(state, atom.phase);
    },
  });
}
