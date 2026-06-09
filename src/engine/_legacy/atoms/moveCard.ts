import type { GameState, Atom, Json } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: '移动牌',
    apply(state: GameState, atom: Atom & { type: '移动牌' }): GameState {
      const cardId = atom.cardId as string;
      const { from, to } = atom;

      let s: GameState = { ...state };

      if (from.zone === '手牌') {
        s = updatePlayer(s, from.player as string, p => ({
          hand: p.hand.filter(id => id !== cardId),
        }));
      } else if (from.zone === '弃牌堆') {
        s = { ...s, zones: { ...s.zones, discardPile: s.zones.discardPile.filter(id => id !== cardId) } };
      } else if (from.zone === '牌堆') {
        s = { ...s, zones: { ...s.zones, deck: s.zones.deck.filter(id => id !== cardId) } };
      } else if (from.zone === '装备') {
        s = updatePlayer(s, from.player as string, p => {
          const eq = { ...p.equipment };
          delete eq[from.slot];
          return { equipment: eq };
        });
      }

      if (to.zone === '手牌') {
        s = updatePlayer(s, to.player as string, p => ({ hand: [...p.hand, cardId] }));
      } else if (to.zone === '弃牌堆') {
        s = { ...s, zones: { ...s.zones, discardPile: [...s.zones.discardPile, cardId] } };
      } else if (to.zone === '牌堆') {
        s = { ...s, zones: { ...s.zones, deck: [...s.zones.deck, cardId] } };
      } else if (to.zone === '装备') {
        s = updatePlayer(s, to.player as string, p => ({
          equipment: { ...p.equipment, [to.slot]: cardId },
        }));
      }

      return s;
    },
  });
}
