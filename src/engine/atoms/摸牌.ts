// src/engine/atoms/摸牌.ts
import type { AtomDefinition } from '../types';
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
    state.zones.deck = state.zones.deck.slice(0, -atom.count);
    state.players[idx].hand.push(...drawn);
  },
  effect: { sound: 'draw', animation: 'slide', duration: 200 },
};

registerAtom(摸牌);
