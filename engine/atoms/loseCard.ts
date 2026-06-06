import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer, getPlayer } from '../state';

export function register() {
  registerAtom({
    type: 'loseCard',
    apply(state: GameState, atom: Atom & { type: 'loseCard' }): GameState {
      const cardId = atom.cardId as string;
      const from = atom.from;
      const playerName = from.player as string;

      if (from.zone === 'hand') {
        const player = getPlayer(state, playerName);
        if (!player.hand.includes(cardId)) return state;
        return {
          ...state,
          players: {
            ...state.players,
            [playerName]: {
              ...player,
              hand: player.hand.filter(id => id !== cardId),
            },
          },
          zones: { ...state.zones, discardPile: [...state.zones.discardPile, cardId] },
        };
      }

      if (from.zone === 'equipment') {
        const player = getPlayer(state, playerName);
        const slot = from.slot;
        if (!slot || player.equipment[slot] !== cardId) return state;
        return updatePlayer(
          { ...state, zones: { ...state.zones, discardPile: [...state.zones.discardPile, cardId] } },
          playerName,
          p => {
            const next = { ...p.equipment };
            delete next[slot!];
            return { equipment: next };
          },
        );
      }

      return state;
    },
    toEvents(_state: GameState, atom: Atom & { type: 'loseCard' }): AtomEventResult {
      const cardId = atom.cardId as string;
      const from = atom.from;
      const payload: Json = { cardId, from: { zone: from.zone, player: from.player as string } };
      const server = makeServerEvent('loseCard', payload);
      return [server, new Map(), makePlayerEvent('loseCard', payload)];
    },
  });
}
