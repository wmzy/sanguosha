import type { GameState, Atom, AtomEventResult, EquipSlot, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';
import type { Card } from '../../../shared/types';

const subtypeToSlot: Record<string, EquipSlot> = {
  '武器': 'weapon',
  '防具': 'armor',
  '进攻马': 'horseMinus',
  '防御马': 'horsePlus',
};

registerAtom({
  type: 'equip',
  apply(state: GameState, atom: Atom & { type: 'equip' }) {
    const player = atom.player as string;
    const cardId = atom.cardId as string;
    const card = state.cardMap[cardId] as Card;
    const slot = subtypeToSlot[card.subtype];
    return updatePlayer(state, player, p => ({
      hand: p.hand.filter(id => id !== cardId),
      equipment: { ...p.equipment, [slot]: cardId },
    }));
  },
  toEvents(state: GameState, atom: Atom & { type: 'equip' }): AtomEventResult {
    const player = atom.player as string;
    const cardId = atom.cardId as string;
    const card = state.cardMap[cardId] as Card;
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
    const slot = atom.slot as EquipSlot;
    return updatePlayer(state, player, p => {
      const eq = { ...p.equipment };
      delete eq[slot];
      return { equipment: eq };
    });
  },
  toEvents(state: GameState, atom: Atom & { type: 'unequip' }): AtomEventResult {
    const player = atom.player as string;
    const slot = atom.slot as EquipSlot;
    const payload: Json = { player, slot };
    const server = makeServerEvent('unequip', payload);
    return [server, new Map(), makePlayerEvent('unequip', payload)];
  },
});
