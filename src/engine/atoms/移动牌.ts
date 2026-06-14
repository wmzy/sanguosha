// src/engine/atoms/移动牌.ts
import type { AtomDefinition, ZoneLoc, ViewEventSplit, ViewEvent, Card } from '../types';
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
      const fromP = atom.from as { zone: '手牌'; player: number };
      state.players[fromP.player].hand = state.players[fromP.player].hand.filter(id => id !== atom.cardId);
    } else if (atom.from.zone === '牌堆') {
      state.zones.deck = state.zones.deck.filter(id => id !== atom.cardId);
    } else if (atom.from.zone === '弃牌堆') {
      state.zones.discardPile = state.zones.discardPile.filter(id => id !== atom.cardId);
    } else if (atom.from.zone === '处理区') {
      state.zones.processing = state.zones.processing.filter(id => id !== atom.cardId);
    }

    // to
    if (atom.to.zone === '手牌') {
      const toP = atom.to as { zone: '手牌'; player: number };
      state.players[toP.player].hand.push(atom.cardId);
    } else if (atom.to.zone === '牌堆') {
      state.zones.deck.push(atom.cardId);
    } else if (atom.to.zone === '弃牌堆') {
      state.zones.discardPile.push(atom.cardId);
      if (state.cardWrappers?.[atom.cardId]) {
        delete state.cardWrappers[atom.cardId];
      }
    } else if (atom.to.zone === '处理区') {
      state.zones.processing.push(atom.cardId);
    }
  },
  toViewEvents(state, atom): ViewEventSplit {
    const card: Card | undefined = state.cardMap[atom.cardId];
    const cardInfo = card ? { name: card.name, suit: card.suit, rank: card.rank } : null;
    const fromPlayer = atom.from.zone === '手牌' ? (atom.from as { zone: '手牌'; player: number }).player : undefined;
    const toPlayer = atom.to.zone === '手牌' ? (atom.to as { zone: '手牌'; player: number }).player : undefined;

    // 弃牌堆目标 → 弃牌事件
    if (atom.to.zone === '弃牌堆' && fromPlayer && cardInfo) {
      const effect = { sound: 'discard' as const, duration: 200 };
      const view: ViewEvent = { type: '弃牌', player: fromPlayer, card: cardInfo, effect };
      return { ownerViews: new Map(), othersView: view };
    }

    // 手牌→处理区 = 打出
    if (atom.to.zone === '处理区' && fromPlayer && cardInfo) {
      const effect = { sound: 'play_card' as const, duration: 200 };
      const view: ViewEvent = { type: '打出', player: fromPlayer, card: cardInfo, effect };
      return { ownerViews: new Map(), othersView: view };
    }

    // 牌堆→手牌 = 摸牌（信息分级）
    if (atom.from.zone === '牌堆' && toPlayer && cardInfo) {
      const effect = { sound: 'draw' as const, animation: 'slide' as const, duration: 200 };
      const ownerView: ViewEvent = { type: '摸牌', player: toPlayer, count: 1, cards: [cardInfo], effect };
      const othersView: ViewEvent = { type: '摸牌', player: toPlayer, count: 1, effect };
      return { ownerViews: new Map([[toPlayer, ownerView]]), othersView };
    }

    // 通用 fallback
    const view: ViewEvent = { type: '移动牌', cardId: atom.cardId, from: atom.from, to: atom.to };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    switch (event.type) {
      case '弃牌':
      case '打出': {
        view.players[pi].handCount = Math.max(0, view.players[pi].handCount - 1);
        if (view.players[pi].hand) {
          const card = event.card as any;
          view.players[pi].hand = view.players[pi].hand!.filter(
            (c: any) => !(c.name === card?.name && c.suit === card?.suit && c.rank === card?.rank)
          );
        }
        break;
      }
      case '摸牌': {
        const count = (event.count as number) ?? 1;
        view.players[pi].handCount += count;
        if (event.cards && view.players[pi].hand) {
          view.players[pi].hand!.push(...(event.cards as any[]));
        }
        break;
      }
    }
  },
};
registerAtom(移动牌);
