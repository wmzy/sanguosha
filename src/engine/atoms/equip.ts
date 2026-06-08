import type { GameState, Atom, EquipSlot } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';

const subtypeToSlot: Record<string, EquipSlot> = {
  武器: '武器',
  防具: '防具',
  进攻马: '进攻马',
  防御马: '防御马',
};

export function register() {
  registerAtom({
    type: '装备',
    apply(state: GameState, atom: Atom & { type: '装备' }) {
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
  });

  registerAtom({
    type: '卸下',
    apply(state: GameState, atom: Atom & { type: '卸下' }) {
      const player = atom.player as string;
      const slot = atom.slot;
      return updatePlayer(state, player, p => {
        const eq = { ...p.equipment };
        delete eq[slot];
        return { equipment: eq };
      });
    },
  });
}
