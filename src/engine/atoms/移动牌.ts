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
      const fromP = atom.from;
      state.players[fromP.player].hand = state.players[fromP.player].hand.filter(
        (id) => id !== atom.cardId,
      );
    } else if (atom.from.zone === '牌堆') {
      state.zones.deck = state.zones.deck.filter((id) => id !== atom.cardId);
    } else if (atom.from.zone === '弃牌堆') {
      state.zones.discardPile = state.zones.discardPile.filter((id) => id !== atom.cardId);
    } else if (atom.from.zone === '处理区') {
      const frame = state.settlementStack[state.settlementStack.length - 1];
      if (frame) frame.cards = frame.cards.filter((id) => id !== atom.cardId);
      else state.zones.processing = state.zones.processing.filter((id) => id !== atom.cardId);
    }

    // to
    if (atom.to.zone === '手牌') {
      const toP = atom.to;
      state.players[toP.player].hand.push(atom.cardId);
    } else if (atom.to.zone === '牌堆') {
      state.zones.deck.push(atom.cardId);
    } else if (atom.to.zone === '弃牌堆') {
      // 影子卡牌还原:转化牌(武圣红牌当杀)入弃牌堆时,用原卡替换
      const card = state.cardMap[atom.cardId];
      if (card.shadowOf) {
        state.zones.discardPile.push(card.shadowOf);
        delete state.cardMap[atom.cardId]; // 删除影子,原卡 cardMap[shadowOf] 仍在
      } else {
        state.zones.discardPile.push(atom.cardId);
      }
    } else if (atom.to.zone === '处理区') {
      const frame = state.settlementStack[state.settlementStack.length - 1];
      if (frame) frame.cards.push(atom.cardId);
      else state.zones.processing.push(atom.cardId);
    }
  },
  toViewEvents(state, atom): ViewEventSplit {
    const card: Card | undefined = state.cardMap[atom.cardId];
    const cardInfo = card ? { name: card.name, suit: card.suit, rank: card.rank } : null;
    const fromPlayer = atom.from.zone === '手牌' ? atom.from.player : undefined;
    const toPlayer = atom.to.zone === '手牌' ? atom.to.player : undefined;

    // 弃牌堆目标 → 弃牌事件
    if (atom.to.zone === '弃牌堆' && fromPlayer !== undefined && cardInfo) {
      const effect = { sound: 'discard' as const, duration: 600 };
      const view: ViewEvent = {
        type: '弃牌',
        player: fromPlayer,
        card: cardInfo,
        cardId: atom.cardId,
        effect,
      };
      return { ownerViews: new Map(), othersView: view };
    }

    // 手牌→处理区 = 打出
    if (atom.to.zone === '处理区' && fromPlayer !== undefined && cardInfo) {
      const effect = { sound: 'play_card' as const, duration: 800 };
      const view: ViewEvent = {
        type: '打出',
        player: fromPlayer,
        card: cardInfo,
        cardId: atom.cardId,
        effect,
      };
      return { ownerViews: new Map(), othersView: view };
    }

    // 牌堆→手牌 = 摸牌（信息分级）
    if (atom.from.zone === '牌堆' && toPlayer !== undefined && cardInfo) {
      const effect = { sound: 'draw' as const, animation: 'slide' as const, duration: 600 };
      const ownerView: ViewEvent = {
        type: '摸牌',
        player: toPlayer,
        count: 1,
        cards: [cardInfo],
        effect,
      };
      const othersView: ViewEvent = { type: '摸牌', player: toPlayer, count: 1, effect };
      return { ownerViews: new Map([[toPlayer, ownerView]]), othersView };
    }

    // 通用 fallback
    const view: ViewEvent = {
      type: '移动牌',
      cardId: atom.cardId,
      from: atom.from,
      to: atom.to,
      player: fromPlayer ?? toPlayer,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    // 通用移动牌:zone 同步必须在 player guard 之前,因为某些移动(如处理区→弃牌堆)无 player
    if (event.type === '移动牌' && view.zones) {
      const from = (event as any).from;
      const to = (event as any).to;
      const cardId = (event as any).cardId as string;
      if (from?.zone === '牌堆') view.zones.deckCount = Math.max(0, view.zones.deckCount - 1);
      else if (from?.zone === '弃牌堆')
        view.zones.discardPileCount = Math.max(0, view.zones.discardPileCount - 1);
      else if (from?.zone === '处理区') {
        const f = view.settlementStack[view.settlementStack.length - 1];
        if (f) f.cards = f.cards.filter((id: string) => id !== cardId);
        if (view.zones)
          view.zones.processing = view.zones.processing.filter((id: string) => id !== cardId);
      }

      if (to?.zone === '牌堆') view.zones.deckCount += 1;
      else if (to?.zone === '弃牌堆') view.zones.discardPileCount += 1;
      else if (to?.zone === '处理区') {
        const f = view.settlementStack[view.settlementStack.length - 1];
        if (f) f.cards.push(cardId);
        if (view.zones) view.zones.processing.push(cardId);
      }
    }

    const pi = view.players.findIndex((p) => p.index === (event.player as number));
    if (pi < 0) return;
    switch (event.type) {
      case '弃牌': {
        view.players[pi].handCount = Math.max(0, view.players[pi].handCount - 1);
        if (view.players[pi].hand && event.cardId) {
          const cardId = event.cardId as string;
          // 用 cardId 精确移除单张,不能用 name/suit/rank 过滤——
          // 标准牌堆中同名同花色同点数的牌有多张(如 杀♠7 有 4 张),
          // 按 name/suit/rank 会误删所有重复牌,导致 hand.length < handCount。
          view.players[pi].hand = view.players[pi].hand.filter((c: Card) => c.id !== cardId);
        }
        if (view.zones) view.zones.discardPileCount += 1;
        break;
      }
      case '打出': {
        view.players[pi].handCount = Math.max(0, view.players[pi].handCount - 1);
        if (view.players[pi].hand && event.cardId) {
          const cardId = event.cardId as string;
          // 同上:用 cardId 精确移除,避免重复牌误删。
          view.players[pi].hand = view.players[pi].hand.filter((c: Card) => c.id !== cardId);
        }
        if (view.zones && event.cardId) {
          view.zones.processing.push(event.cardId as string);
          const f = view.settlementStack[view.settlementStack.length - 1];
          if (f) f.cards.push(event.cardId as string);
        }
        break;
      }
      case '摸牌': {
        const count = (event.count as number) ?? 1;
        view.players[pi].handCount += count;
        if (event.cards && view.players[pi].hand) {
          view.players[pi].hand.push(...(event.cards as Card[]));
        }
        if (view.zones) view.zones.deckCount = Math.max(0, view.zones.deckCount - count);
        break;
      }
      default: {
        // 通用移动(装备/转化等):from/to 手牌 → handCount ±1
        // 必须独立查找 from/to 玩家,因为 event.player 只是其中之一
        const from = (event as any).from;
        const to = (event as any).to;
        const cardId = (event as any).cardId as string;
        if (from?.zone === '手牌' && from?.player !== undefined) {
          const fromPi = view.players.findIndex((p) => p.index === from.player);
          if (fromPi >= 0) {
            view.players[fromPi].handCount = Math.max(0, view.players[fromPi].handCount - 1);
            if (view.players[fromPi].hand) {
              view.players[fromPi].hand = view.players[fromPi].hand.filter(
                (c: Card) => c.id !== cardId,
              );
            }
          }
        }
        if (to?.zone === '手牌' && to?.player !== undefined) {
          const toPi = view.players.findIndex((p) => p.index === to.player);
          if (toPi >= 0) {
            view.players[toPi].handCount += 1;
            if (cardId && view.players[toPi].hand) {
              const card = view.cardMap[cardId];
              if (card) view.players[toPi].hand.push(card);
            }
          }
        }
        break;
      }
    }
  },
};
registerAtom(移动牌);
