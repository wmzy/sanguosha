import type { GameState, Atom, AtomEventResult, Json, ZoneLoc } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

function removeCardFromZone(state: GameState, cardId: string, from: ZoneLoc): GameState {
  switch (from.zone) {
    case 'deck':
      return { ...state, zones: { ...state.zones, deck: state.zones.deck.filter(id => id !== cardId) } };
    case 'discardPile':
      return { ...state, zones: { ...state.zones, discardPile: state.zones.discardPile.filter(id => id !== cardId) } };
    case 'hand':
      return updatePlayer(state, from.player, p => ({
        hand: p.hand.filter(id => id !== cardId),
      }));
    case 'equipment':
      return updatePlayer(state, from.player, p => {
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
    type: 'gainCard',
    apply(state: GameState, atom: Atom & { type: 'gainCard' }): GameState {
      const player = atom.player as string;
      const cardId = atom.cardId as string;
      const { from } = atom;

      const removed = removeCardFromZone(state, cardId, from);
      return updatePlayer(removed, player, p => ({
        hand: [...p.hand, cardId],
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: 'gainCard' }): AtomEventResult {
      const player = atom.player as string;
      const cardId = atom.cardId as string;
      const { from } = atom;
      const card = state.cardMap[cardId];

      const server = makeServerEvent('cardGained', { player, cardId, card: card as unknown as Json, from: from as unknown as Json });
      const ownerEvent = makePlayerEvent('cardGained', { player, cardId, card: card as unknown as Json, from: from as unknown as Json });
      const otherEvent = makePlayerEvent('cardGained', { player, cardId, from: from as unknown as Json });

      return [server, new Map([[player, ownerEvent]]), otherEvent];
    },
  });
}
