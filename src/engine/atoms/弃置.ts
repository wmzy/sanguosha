// src/engine/atoms/弃置.ts
// 弃置:从玩家手牌/装备区将 cardIds 移至弃牌堆
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

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
    player.hand = player.hand.filter(id => !discardSet.has(id));
    const equipment: Record<string, string> = {};
    for (const [slot, id] of Object.entries(player.equipment)) {
      if (id && !discardSet.has(id)) equipment[slot] = id;
    }
    player.equipment = equipment;
    state.zones.discardPile.push(...atom.cardIds);
  },
  effect: { sound: 'discard', animation: 'flip', duration: 600 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '弃置',
      player: atom.player,
      cardIds: atom.cardIds,
      effect: { sound: 'discard' as const, animation: 'flip' as const, duration: 600 },
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    const cardIds = (event.cardIds as string[]) ?? [];
    const count = cardIds.length;
    view.players[pi].handCount = Math.max(0, view.players[pi].handCount - count);
    if (view.players[pi].hand && cardIds.length > 0) {
      const discardSet = new Set(cardIds);
      view.players[pi].hand = view.players[pi].hand!.filter(c => !discardSet.has(c.id));
    }
    if (view.zones) {
      view.zones.discardPileCount += count;
    }
  },
};

registerAtom(弃置);
