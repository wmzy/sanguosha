// src/engine/atoms/装备.ts
// 装备:玩家装备 cardId(从手牌移除,放入 equipment 槽位)
import type { AtomDefinition, EquipSlot } from '../types';
import { registerAtom } from '../atom';

function inferSlot(cardType: string | undefined): EquipSlot | null {
  switch (cardType) {
    case '武器': return '武器';
    case '防具': return '防具';
    case '进攻马': return '进攻马';
    case '防御马': return '防御马';
    case '宝物': return '宝物';
    default: return null;
  }
}

export const 装备: AtomDefinition<{ player: number; cardId: string }> = {
  type: '装备',
  validate(state, atom) {
    const p = state.players[atom.player];
    if (!p) return `player ${atom.player} not found`;
    if (!p.hand.includes(atom.cardId)) return `card not in player's hand`;
    const card = state.cardMap[atom.cardId];
    if (!card) return `card ${atom.cardId} not found`;
    const slot = inferSlot(card.subtype);
    if (!slot) return `card is not equipment`;
    return null;
  },
  apply(state, atom) {
    const card = state.cardMap[atom.cardId];
    const slot = inferSlot(card.subtype)!;
    const player = state.players[atom.player];
    player.hand = player.hand.filter(id => id !== atom.cardId);
    player.equipment[slot] = atom.cardId;
  },
};

registerAtom(装备);
