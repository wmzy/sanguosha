// src/engine/atoms/移动牌.ts
import type { AtomDefinition, GameState, ZoneLoc } from '../types';
import { registerAtom } from '../atom';

export const 移动牌: AtomDefinition<{ cardId: string; from: ZoneLoc; to: ZoneLoc }> = {
  type: '移动牌',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply(state, atom) {
    let next = { ...state };

    // from
    if (atom.from.zone === '手牌') {
      const pIdx = next.players.findIndex(p => p.name === atom.from.player);
      if (pIdx >= 0) {
        const hand = next.players[pIdx].hand.filter(id => id !== atom.cardId);
        next.players = next.players.map((p, i) => i === pIdx ? { ...p, hand } : p);
      }
    } else if (atom.from.zone === '牌堆') {
      next.zones = { ...next.zones, deck: next.zones.deck.filter(id => id !== atom.cardId) };
    } else if (atom.from.zone === '弃牌堆') {
      next.zones = { ...next.zones, discardPile: next.zones.discardPile.filter(id => id !== atom.cardId) };
    } else if (atom.from.zone === '处理区') {
      next.zones = { ...next.zones, processing: next.zones.processing.filter(id => id !== atom.cardId) };
    }

    // to
    if (atom.to.zone === '手牌') {
      const pIdx = next.players.findIndex(p => p.name === atom.to.player);
      if (pIdx >= 0) {
        const hand = [...next.players[pIdx].hand, atom.cardId];
        next.players = next.players.map((p, i) => i === pIdx ? { ...p, hand } : p);
      }
    } else if (atom.to.zone === '牌堆') {
      next.zones = { ...next.zones, deck: [...next.zones.deck, atom.cardId] };
    } else if (atom.to.zone === '弃牌堆') {
      next.zones = { ...next.zones, discardPile: [...next.zones.discardPile, atom.cardId] };
      // 牌移入弃牌堆时清理包装(武圣等转化技的还原)
      if (next.cardWrappers?.[atom.cardId]) {
        const { [atom.cardId]: _, ...rest } = next.cardWrappers;
        next = { ...next, cardWrappers: rest };
      }
    } else if (atom.to.zone === '处理区') {
      next.zones = { ...next.zones, processing: [...next.zones.processing, atom.cardId] };
    }

    return next;
  },
};
registerAtom(移动牌);