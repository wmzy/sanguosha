// src/engine/atoms/摸牌.ts
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 摸牌: AtomDefinition<{ player: number; count: number }> = {
  type: '摸牌',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (atom.count <= 0) return 'count must be > 0';
    if (state.zones.deck.length < atom.count) return 'deck empty';
    return null;
  },
  apply(state, atom) {
    const drawn = state.zones.deck.slice(-atom.count).reverse();
    state.zones.deck = state.zones.deck.slice(0, -atom.count);
    state.players[atom.player].hand.push(...drawn);
  },
  effect: { sound: 'draw', animation: 'slide', duration: 200 },
  toViewEvents(state, atom): ViewEventSplit {
    const effect = { sound: 'draw' as const, animation: 'slide' as const, duration: 200 };
    // 本人看到具体牌面
    const drawn = state.zones.deck.slice(-atom.count).reverse();
    const cards = drawn.map(id => state.cardMap[id]).filter(Boolean);
    const ownerView: ViewEvent = {
      type: '摸牌',
      player: atom.player,
      count: atom.count,
      cards,
      effect,
    };
    // 其他人只看到数量
    const othersView: ViewEvent = {
      type: '摸牌',
      player: atom.player,
      count: atom.count,
      effect,
    };
    return {
      ownerViews: new Map([[atom.player, ownerView]]),
      othersView,
    };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    const count = (event.count as number) ?? 0;
    view.players[pi].handCount += count;
    // owner 有 cards 字段，加入手牌；others 没有
    if (event.cards && view.players[pi].hand) {
      view.players[pi].hand!.push(...(event.cards as any[]));
    }
  },
};

registerAtom(摸牌);
