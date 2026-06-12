// src/engine/atoms/移动牌.ts
import type { AtomDefinition, ZoneLoc } from '../types';
import { registerAtom } from '../atom';

export const 移动牌: AtomDefinition<{ cardId: string; from: ZoneLoc; to: ZoneLoc }> = {
  type: '移动牌',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply(state, atom) {
    // from
    if (atom.from.zone === '手牌') {
      const pIdx = state.players.findIndex(p => p.name === (atom.from as { zone: '手牌'; player: string }).player);
      if (pIdx >= 0) {
        state.players[pIdx].hand = state.players[pIdx].hand.filter(id => id !== atom.cardId);
      }
    } else if (atom.from.zone === '牌堆') {
      state.zones.deck = state.zones.deck.filter(id => id !== atom.cardId);
    } else if (atom.from.zone === '弃牌堆') {
      state.zones.discardPile = state.zones.discardPile.filter(id => id !== atom.cardId);
    } else if (atom.from.zone === '处理区') {
      state.zones.processing = state.zones.processing.filter(id => id !== atom.cardId);
    }

    // to
    if (atom.to.zone === '手牌') {
      const pIdx = state.players.findIndex(p => p.name === (atom.to as { zone: '手牌'; player: string }).player);
      if (pIdx >= 0) {
        state.players[pIdx].hand.push(atom.cardId);
      }
    } else if (atom.to.zone === '牌堆') {
      state.zones.deck.push(atom.cardId);
    } else if (atom.to.zone === '弃牌堆') {
      state.zones.discardPile.push(atom.cardId);
      // 牌移入弃牌堆时清理包装(武圣等转化技的还原)
      if (state.cardWrappers?.[atom.cardId]) {
        delete state.cardWrappers[atom.cardId];
      }
    } else if (atom.to.zone === '处理区') {
      state.zones.processing.push(atom.cardId);
    }
  },
};
registerAtom(移动牌);
