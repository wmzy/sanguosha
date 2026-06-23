// 卸下:玩家卸下指定槽位的装备,返回手牌
// 副作用:清除武器攻击范围 vars(距离/出杀范围)。
// 进攻马/防御马的 vars 由马匹技能的 移除技能 hook 清理,不在此硬编码。
import type { AtomDefinition, EquipSlot, GameState, ViewEventSplit, ViewEvent } from '../types';
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
  effect: { sound: 'unequip', animation: 'fade', duration: 400 },
  toViewEvents(state, atom): ViewEventSplit {
    const cardId = state.players[atom.player].equipment[atom.slot];
    const view: ViewEvent = {
      type: '卸下',
      player: atom.player,
      slot: atom.slot,
      ...(cardId ? { cardId } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    const slot = event.slot as '武器' | '防具' | '进攻马' | '防御马' | '宝物' | undefined;
    const cardId = event.cardId as string | undefined;
    if (slot) {
      delete view.players[pi].equipment[slot];
    }
    // apply 把卸下的牌返回手牌(player.hand.push(cardId)),applyView 必须镜像:
    // handCount + 1;可见时(owner 视角)把牌加回 hand 数组。
    if (cardId) {
      view.players[pi].handCount += 1;
      if (view.players[pi].hand) {
        const card = view.cardMap[cardId];
        if (card) view.players[pi].hand!.push(card);
      }
    }
    // 武器卸下:清除 distanceVars.attackRange(马匹由 移除技能 atom 处理)
    if (slot === '武器' && view.players[pi].distanceVars) {
      view.players[pi].distanceVars = {
        ...view.players[pi].distanceVars,
        attackRange: undefined,
      };
    }
  },
};

registerAtom(卸下);
