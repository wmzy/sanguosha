// 卸下:玩家卸下指定槽位的装备,返回手牌
// 副作用:清除装备带来的距离修正 vars(对应 装备 atom 的设置)。
import type { AtomDefinition, EquipSlot, GameState } from '../types';
import { registerAtom } from '../atom';

/** 清除装备带来的距离修正 vars */
function clearEquipVars(state: GameState, playerIdx: number, slot: EquipSlot): void {
  const vars = state.players[playerIdx].vars;
  switch (slot) {
    case '进攻马':
      delete vars['距离/进攻修正'];
      break;
    case '防御马':
      delete vars['距离/防御修正'];
      break;
    case '武器':
      delete vars['距离/出杀范围'];
      break;
  }
}

export const 卸下: AtomDefinition<{ player: number; slot: '武器' | '防具' | '进攻马' | '防御马' | '宝物' }> = {
  type: '卸下',
  validate(state, atom) {
    const p = state.players[atom.player];
    if (!p) return `player ${atom.player} not found`;
    if (!p.equipment[atom.slot]) return `no equipment in slot ${atom.slot}`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const cardId = player.equipment[atom.slot]!;
    delete player.equipment[atom.slot];
    player.hand.push(cardId);
    // 清除距离修正 vars
    clearEquipVars(state, atom.player, atom.slot);
  },
};

registerAtom(卸下);
