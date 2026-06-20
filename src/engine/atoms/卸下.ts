// 卸下:玩家卸下指定槽位的装备,返回手牌
// 副作用:清除武器攻击范围 vars(距离/出杀范围)。
// 进攻马/防御马的 vars 由马匹技能的 移除技能 hook 清理,不在此硬编码。
import type { AtomDefinition, EquipSlot, GameState } from '../types';
import { registerAtom } from '../atom';

/** 清除装备带来的 vars(仅武器范围;马匹由技能处理) */
function clearEquipVars(state: GameState, playerIdx: number, slot: EquipSlot): void {
  const vars = state.players[playerIdx].vars;
  if (slot === '武器') {
    delete vars['距离/出杀范围'];
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
