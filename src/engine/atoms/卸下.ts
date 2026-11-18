// 卸下:玩家卸下指定槽位的装备,返回手牌
// 副作用:清除武器攻击范围 vars(距离/出杀范围,由 _helpers.clearEquipVars 统一实现,
// 与 移出至暂存区 的武器移出共用;view 侧配对 clearEquipViewVars 清 distanceVars.attackRange)。
// 进攻马/防御马的 vars 由马匹技能的 移除技能 hook 清理,不在此硬编码。
import type { AtomDefinition, EquipSlot, ViewEventSplit, ViewEvent } from '../types';
import { addCardToHand, broadcast, clearEquipVars, clearEquipViewVars, requirePlayer, viewPlayer } from './_helpers';

export const 卸下: AtomDefinition<{
  player: number;
  slot: EquipSlot;
}> = {
  type: '卸下',
  validate(state, atom) {
    const err = requirePlayer(state, atom.player, 'player');
    if (err) return err;
    const p = state.players[atom.player];
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
    return broadcast(view);
  },
  applyView(view, event) {
    const p = viewPlayer(view, event.player as number);
    if (!p) return;
    const slot = event.slot as EquipSlot | undefined;
    const cardId = event.cardId as string | undefined;
    if (slot) {
      delete p.equipment[slot];
    }
    // apply 把卸下的牌返回手牌(player.hand.push(cardId)),applyView 必须镜像:
    // handCount + 1;可见时(owner 视角)把牌加回 hand 数组。
    if (cardId) {
      addCardToHand(view, event.player as number, cardId);
    }
    // 武器卸下:清除 distanceVars.attackRange(马匹由 移除技能 atom 处理)
    if (slot) {
      clearEquipViewVars(p, slot);
    }
  },
};

