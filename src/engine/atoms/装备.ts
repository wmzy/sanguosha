// 装备:玩家装备 cardId(从手牌移除,放入 equipment 槽位)
// 副作用:根据装备类型设 player.vars 距离修正(进攻马/防御马/武器范围)。
// 对应 卸下 atom 负责清除。
import type { AtomDefinition, EquipSlot, GameState } from '../types';
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

/** 设装备带来的距离修正 vars */
function applyEquipVars(state: GameState, playerIdx: number, slot: EquipSlot, card: { name: string; range?: number }): void {
  const vars = state.players[playerIdx].vars;
  switch (slot) {
    case '进攻马':
      vars['距离/进攻修正'] = 1;
      break;
    case '防御马':
      vars['距离/防御修正'] = 1;
      break;
    case '武器':
      vars['距离/出杀范围'] = card.range ?? 1;
      break;
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
    // 设距离修正 vars(卸下 atom 清除)
    applyEquipVars(state, atom.player, slot, card);
  },
};

registerAtom(装备);
