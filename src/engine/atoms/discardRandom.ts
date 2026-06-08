import type { GameState, Atom, Json } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';
import { createRng } from '../../shared/rng';

export function register() {
  registerAtom({
    type: '随机弃置',
    apply(state: GameState, atom: Atom & { type: '随机弃置'; player: string; count: number; from: '手牌' | '装备' }) {
      const player = atom.player;
      const count = atom.count;
      const from = atom.from;
      const p = state.players[player];
      if (!p) return state;

      if (from === '手牌') {
        const rng = createRng(state.rngState);
        const hand = [...p.hand];
        const discarded: string[] = [];
        for (let i = 0; i < count && hand.length > 0; i++) {
          const idx = rng.nextInt(hand.length);
          discarded.push(hand.splice(idx, 1)[0]);
        }
        return {
          ...updatePlayer(state, player, _p => ({ hand })),
          zones: { ...state.zones, discardPile: [...state.zones.discardPile, ...discarded] },
          rngState: state.rngState + count,
        };
      }

      return state;
    },
    getResult(state: GameState, _atom: Atom & { type: '随机弃置'; player: string; count: number; from: '手牌' | '装备' }): Record<string, Json> {
      const discardPile = state.zones.discardPile;
      if (discardPile.length === 0) return {};
      const lastCardId = discardPile[discardPile.length - 1];
      return { discardedCardId: lastCardId };
    },
  });
}
