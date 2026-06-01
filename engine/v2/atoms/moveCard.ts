import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: 'moveCard',
    apply(state: GameState, atom: Atom & { type: 'moveCard' }): GameState {
      const cardId = atom.cardId as string;
      const { from, to } = atom;

      let s: GameState = { ...state };

      if (from.zone === 'hand') {
        s = updatePlayer(s, from.player, p => ({
          hand: p.hand.filter(id => id !== cardId),
        }));
      } else if (from.zone === 'discardPile') {
        s = { ...s, zones: { ...s.zones, discardPile: s.zones.discardPile.filter(id => id !== cardId) } };
      } else if (from.zone === 'deck') {
        s = { ...s, zones: { ...s.zones, deck: s.zones.deck.filter(id => id !== cardId) } };
      } else if (from.zone === 'equipment') {
        s = updatePlayer(s, from.player, p => {
          const eq = { ...p.equipment };
          delete eq[from.slot];
          return { equipment: eq };
        });
      }

      if (to.zone === 'hand') {
        s = updatePlayer(s, to.player, p => ({ hand: [...p.hand, cardId] }));
      } else if (to.zone === 'discardPile') {
        s = { ...s, zones: { ...s.zones, discardPile: [...s.zones.discardPile, cardId] } };
      } else if (to.zone === 'deck') {
        s = { ...s, zones: { ...s.zones, deck: [...s.zones.deck, cardId] } };
      } else if (to.zone === 'equipment') {
        s = updatePlayer(s, to.player, p => ({
          equipment: { ...p.equipment, [to.slot]: cardId },
        }));
      }

      return s;
    },
    toEvents(_state: GameState, atom: Atom & { type: 'moveCard' }): AtomEventResult {
      const cardId = atom.cardId as string;
      const payload: Json = { cardId, from: atom.from as unknown as Json, to: atom.to as unknown as Json };
      const server = makeServerEvent('cardMoved', payload);
      return [server, new Map(), makePlayerEvent('cardMoved', payload)];
    },
  });
}
