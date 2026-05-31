import type { GameState, Atom, AtomEventResult, EquipSlot, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';
import type { Card } from '../../../shared/types';

const subtypeToSlot: Record<string, EquipSlot> = {
  武器: 'weapon',
  防具: 'armor',
  进攻马: 'horseMinus',
  防御马: 'horsePlus',
};

export function register() {
  registerAtom({
    type: 'equip',
    apply(state: GameState, atom: Atom & { type: 'equip' }) {
      const player = atom.player as string;
      const cardId = atom.cardId as string;
      const card = state.cardMap[cardId];
      const slot = subtypeToSlot[card.subtype];
      const p = state.players[player];
      const oldEquipId = p.equipment[slot];

      let s: GameState = updatePlayer(state, player, p => ({
        hand: p.hand.filter(id => id !== cardId),
        equipment: { ...p.equipment, [slot]: cardId },
      }));

      if (oldEquipId) {
        s = {
          ...s,
          zones: {
            ...s.zones,
            discardPile: [...s.zones.discardPile, oldEquipId],
          },
        };
      }

      return s;
    },
    toEvents(state: GameState, atom: Atom & { type: 'equip' }): AtomEventResult {
      const player = atom.player as string;
      const cardId = atom.cardId as string;
      const card = state.cardMap[cardId];
      const slot = subtypeToSlot[card.subtype];
      const payload: Json = { player, cardId, slot };
      const server = makeServerEvent('equip', payload);
      return [server, new Map(), makePlayerEvent('equip', payload)];
    },
  });

  registerAtom({
    type: 'unequip',
    apply(state: GameState, atom: Atom & { type: 'unequip' }) {
      const player = atom.player as string;
      const slot = atom.slot;
      return updatePlayer(state, player, p => {
        const eq = { ...p.equipment };
        delete eq[slot];
        return { equipment: eq };
      });
    },
    toEvents(state: GameState, atom: Atom & { type: 'unequip' }): AtomEventResult {
      const player = atom.player as string;
      const slot = atom.slot;
      const payload: Json = { player, slot };
      const server = makeServerEvent('unequip', payload);
      return [server, new Map(), makePlayerEvent('unequip', payload)];
    },
  });
}
