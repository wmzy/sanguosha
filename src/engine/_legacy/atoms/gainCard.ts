// @ts-nocheck
import type { GameState, Atom, Json, ZoneLoc } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';

function removeCardFromZone(state: GameState, cardId: string, from: ZoneLoc): GameState {
  switch (from.zone) {
    case '牌堆':
      return { ...state, zones: { ...state.zones, deck: state.zones.deck.filter(id => id !== cardId) } };
    case '弃牌堆':
      return { ...state, zones: { ...state.zones, discardPile: state.zones.discardPile.filter(id => id !== cardId) } };
    case '手牌':
      return updatePlayer(state, from.player as string, p => ({
        hand: p.hand.filter(id => id !== cardId),
      }));
    case '装备':
      return updatePlayer(state, from.player as string, p => {
        const equipment = { ...p.equipment };
        if (equipment[from.slot] === cardId) {
          delete equipment[from.slot];
        }
        return { equipment };
      });
  }
}

export function register() {
  registerAtom({
    type: '获得',
    apply(state: GameState, atom: Atom & { type: '获得' }): GameState {
      const player = atom.player as string;
      const cardId = atom.cardId as string;
      const { from } = atom;

      const removed = removeCardFromZone(state, cardId, from);
      return updatePlayer(removed, player, p => ({
        hand: [...p.hand, cardId],
      }));
    },
  });
}
