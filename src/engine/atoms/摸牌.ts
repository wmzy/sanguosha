// src/engine/atoms/摸牌.ts
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 摸牌: AtomDefinition<{ player: string; count: number }> = {
  type: '摸牌',
  validate(state, atom) {
    const p = state.players.find(x => x.index === state.players.findIndex(y => y.name === atom.player));
    if (!p) return `player ${atom.player} not found`;
    if (atom.count <= 0) return 'count must be > 0';
    if (state.zones.deck.length < atom.count) return 'deck empty';
    return null;
  },
  apply(state, atom) {
    const idx = state.players.findIndex(p => p.name === atom.player);
    const drawn = state.zones.deck.slice(-atom.count).reverse();
    const newDeck = state.zones.deck.slice(0, -atom.count);
    const newHand = [...state.players[idx].hand, ...drawn];
    return {
      ...state,
      zones: { ...state.zones, deck: newDeck },
      players: state.players.map((p, i) =>
        i === idx ? { ...p, hand: newHand } : p,
      ),
    };
  },
  effect: { sound: 'draw', animation: 'slide', duration: 200 },
};

registerAtom(摸牌);