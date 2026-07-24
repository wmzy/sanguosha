// src/engine/atoms/弃置.ts
// 弃置:从玩家手牌/装备区将 cardIds 移至弃牌堆
//
// 模块 F 迁移(flow-redesign.md):afterApply 为来自手牌的弃牌发出「移动到目标区域后」
// 时机标记(reason='弃置',to='弃牌堆'),为连营/落英/屯田等「失去牌」技能提供统一 hook 点。
// ZoneLoc 不含「装备」区域,装备/判定区弃置不发标记——失去牌类技能主要关心手牌。
// 本 atom 的 apply + view 事件保持不变(含信息分级),时机标记仅为额外 hook 注册点。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { applyAtom } from '../create-engine';

/** localVars key:本次弃置中来自手牌的 cardId(afterApply 发时机标记用)。
 *  apply→afterApply 之间无其他 atom 运行,单键安全。 */
const MOVED_HAND_KEY = '__弃置/手牌卡';

export const 弃置: AtomDefinition<{ player: number; cardIds: string[] }> = {
  type: '弃置',
  validate(state, atom) {
    if (atom.cardIds.length === 0) return 'no cards to discard';
    const p = state.players[atom.player];
    if (!p) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const discardSet = new Set(atom.cardIds);
    // 捕获本次弃置中来自手牌的 cardId(供 afterApply 发「移动到目标区域后」时机标记)
    state.localVars[MOVED_HAND_KEY] = atom.cardIds.filter((id) => player.hand.includes(id));
    player.hand = player.hand.filter((id) => !discardSet.has(id));
    const equipment: Record<string, string> = {};
    for (const [slot, id] of Object.entries(player.equipment)) {
      if (id && !discardSet.has(id)) equipment[slot] = id;
    }
    player.equipment = equipment;
    state.zones.discardPile.push(...atom.cardIds);
  },
  /** 模块 F:为来自手牌的弃牌逐张发出「移动到目标区域后」时机标记(reason='弃置')。
   *  标记为事件型(无副作用、无 view),不改变本 atom 的视图/状态语义。 */
  async afterApply(state, atom) {
    const handCardIds = state.localVars[MOVED_HAND_KEY] as string[] | undefined;
    delete state.localVars[MOVED_HAND_KEY];
    if (!handCardIds || handCardIds.length === 0) return;
    for (const cardId of handCardIds) {
      await applyAtom(state, {
        type: '移动到目标区域后',
        cardId,
        from: { zone: '手牌', player: atom.player },
        to: { zone: '弃牌堆' },
        reason: '弃置',
      });
    }
  },
  effect: { sound: 'discard', animation: 'flip', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    // toViewEvents 在 apply 之前调用,此时 state 尚未变更。
    // 记录每张牌所在区域(zone),供 applyView 精确扣减 handCount/equipment。
    const player = state.players[atom.player];
    const equipSet = new Set(Object.values(player.equipment).filter(Boolean));
    const zones: Record<string, string> = {};
    for (const cardId of atom.cardIds) {
      if (player.hand.includes(cardId)) zones[cardId] = 'hand';
      else if (equipSet.has(cardId)) zones[cardId] = 'equipment';
      else zones[cardId] = 'judge';
    }
    const view: ViewEvent = {
      type: '弃置',
      player: atom.player,
      cardIds: atom.cardIds,
      zones,
      // 弃牌堆是公开信息:所有玩家都能看到弃了什么牌
      cardNames: atom.cardIds.map((id) => state.cardMap[id]?.name).filter(Boolean),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    const cardIds = (event.cardIds as string[]) ?? [];
    const zones = (event.zones as Record<string, string>) ?? {};
    const discardSet = new Set(cardIds);
    // 装备区:清除被弃的装备(与 apply 对称)
    const equipment: Partial<Record<string, string>> = {};
    for (const [slot, id] of Object.entries(view.players[pi].equipment)) {
      if (id && discardSet.has(id)) {
        // 装备在弃牌集中:不纳入 equipment
      } else if (id) {
        equipment[slot] = id;
      }
    }
    view.players[pi].equipment = equipment;
    // 手牌:只减在 hand 区域的牌(判定区牌不在 hand/equip,不应减 handCount)
    const handRemoved = cardIds.filter((id) => zones[id] === 'hand').length;
    view.players[pi].handCount = Math.max(0, view.players[pi].handCount - handRemoved);
    if (view.players[pi].hand && handRemoved > 0) {
      view.players[pi].hand = view.players[pi].hand.filter((c) => !discardSet.has(c.id));
    }
    if (view.zones) {
      view.zones.discardPileCount += cardIds.length;
    }
  },
  toViewLog(event, _viewer) {
    const cardIds = event.cardIds;
    const count = Array.isArray(cardIds) ? cardIds.length : 0;
    const cardNames = event.cardNames as string[] | undefined;
    if (cardNames && cardNames.length > 0) {
      const names = cardNames.join('、');
      return { player: event.player as number, text: `弃置了 ${count} 张牌：${names}` };
    }
    return { player: event.player as number, text: `弃置了 ${count} 张牌` };
  },
};

registerAtom(弃置);
