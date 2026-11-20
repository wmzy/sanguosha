// src/engine/atoms/移动牌.ts
import type {
  AtomDefinition,
  ZoneLoc,
  ViewEventSplit,
  ViewEvent,
  Card,
} from '../types';
import { addCardToHand, applyDrawEvent, broadcast, pushToDiscardPile, removeCardFromHand, takeFromDeck, viewPlayer } from './_helpers';

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
      // 就地 splice 而非重建数组:判定流程用 bindJudgeCard 持有牌区**引用**
      // (取代旧的「await 后再读帧顶」的猜测),重建数组会让该引用失效——
      // 改判(鬼道/鬼才)后收尾找不到最终判定牌,替换牌滞留在处理区/视图里。
      const cards = frame ? frame.cards : state.zones.processing;
      const index = cards.indexOf(atom.cardId);
      if (index >= 0) cards.splice(index, 1);
    }

    // to
    if (atom.to.zone === '手牌') {
      const toP = atom.to;
      state.players[toP.player].hand.push(atom.cardId);
    } else if (atom.to.zone === '牌堆') {
      state.zones.deck.push(atom.cardId);
    } else if (atom.to.zone === '弃牌堆') {
      // 牌入堆单点裁决(临时牌销毁/影子卡还原/原样入堆,语义见 _helpers.pushToDiscardPile)
      pushToDiscardPile(state, atom.cardId);
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
    // 影子卡牌还原:转化牌(如武圣红牌当杀)入弃牌堆时,apply 用原卡替换入堆。
    // toViewEvents 在 apply 前调用,此时影子 cardMap 仍在、可读到 shadowOf 指向的原卡。
    // 故 ViewEvent.card 展示原卡信息(与后端 discardPile 实际收到的牌一致);
    // cardId 仍为影子 id,供前端从玩家手牌精确过滤(手牌引用的是影子 id)。
    if (atom.to.zone === '弃牌堆' && fromPlayer !== undefined && cardInfo) {
      const origCard = card?.shadowOf ? state.cardMap[card.shadowOf] : undefined;
      const shownCard = origCard
        ? { name: origCard.name, suit: origCard.suit, rank: origCard.rank }
        : cardInfo;
      const effect = { sound: 'flip' as const, duration: 600 };
      const view: ViewEvent = {
        type: '弃牌',
        player: fromPlayer,
        card: shownCard,
        cardId: atom.cardId,
        effect,
      };
      return broadcast(view);
    }

    // 手牌→处理区 = 使用/打出置入处理区。后续必有「使用时」/「打出牌时」atom
    // 按牌名播报(card/{牌名}),此处不再叠 flip 拟声。自己出牌另有手牌飞行动画;
    // 他人出牌由中央 PlayHistoryStrip 展示(duration 控制其停留时长)。
    if (atom.to.zone === '处理区' && fromPlayer !== undefined && cardInfo) {
      const effect = { animation: 'flip' as const, duration: 800 };
      const view: ViewEvent = {
        type: '打出',
        player: fromPlayer,
        card: cardInfo,
        cardId: atom.cardId,
        effect,
      };
      return broadcast(view);
    }

    // 牌堆→手牌 = 摸牌（信息分级）
    if (atom.from.zone === '牌堆' && toPlayer !== undefined && card) {
      const effect = { sound: 'flip' as const, animation: 'slide' as const, duration: 600 };
      // 使用完整 card 对象(同 摸牌 atom),保证 applyView 后 hand 各字段与 buildView 一致
      const ownerView: ViewEvent = {
        type: '摸牌',
        player: toPlayer,
        count: 1,
        cards: [card],
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
      // 结算临时牌:apply 将销毁而非入弃牌堆。标志随事件下发(增量端 cardMap
      // 镜像可能没有该虚拟牌条目——hook 直接写 cardMap 不产生事件),applyView 据此同步。
      ...(state.cardMap[atom.cardId]?.ephemeral ? { ephemeral: true } : {}),
    };
    return broadcast(view);
  },
  applyView(view, event) {
    // 通用移动牌:zone 同步必须在 player guard 之前,因为某些移动(如处理区→弃牌堆)无 player
    if (event.type === '移动牌' && view.zones) {
      const from = event.from as ZoneLoc;
      const to = event.to as ZoneLoc;
      const cardId = event.cardId as string;
      if (from?.zone === '牌堆') takeFromDeck(view, 1);
      else if (from?.zone === '弃牌堆')
        view.zones.discardPileCount = Math.max(0, view.zones.discardPileCount - 1);
      else if (from?.zone === '处理区') {
        const f = view.settlementStack[view.settlementStack.length - 1];
        if (f) f.cards = f.cards.filter((id: string) => id !== cardId);
        if (view.zones)
          view.zones.processing = view.zones.processing.filter((id: string) => id !== cardId);
      }

      if (to?.zone === '牌堆') view.zones.deckCount += 1;
      else if (to?.zone === '弃牌堆') {
        // 结算临时牌(ephemeral)在后端被销毁而非入弃牌堆,视图同步:不加计数。
        // 标志读事件本体(虚拟牌经 hook 直接写 cardMap,增量端镜像未必有该条目)。
        if ((event as { ephemeral?: unknown }).ephemeral !== true) {
          view.zones.discardPileCount += 1;
        }
      } else if (to?.zone === '处理区') {
        const f = view.settlementStack[view.settlementStack.length - 1];
        if (f) f.cards.push(cardId);
        if (view.zones) view.zones.processing.push(cardId);
      }
    }

    const p = viewPlayer(view, event.player as number);
    if (!p) return;
    switch (event.type) {
      case '弃牌': {
        removeCardFromHand(p, event.cardId as string);
        if (view.zones) view.zones.discardPileCount += 1;
        break;
      }
      case '打出': {
        removeCardFromHand(p, event.cardId as string);
        if (view.zones && event.cardId) {
          view.zones.processing.push(event.cardId as string);
          const f = view.settlementStack[view.settlementStack.length - 1];
          if (f) f.cards.push(event.cardId as string);
        }
        break;
      }
      case '摸牌': {
        // 牌堆→手牌的摸牌投影,与 摸牌 atom 的 applyView 共用单点
        applyDrawEvent(view, event);
        break;
      }
      default: {
        // 通用移动(装备/转化等):from/to 手牌 → handCount ±1
        // 必须独立查找 from/to 玩家,因为 event.player 只是其中之一
        const from = event.from as ZoneLoc;
        const to = event.to as ZoneLoc;
        const cardId = event.cardId as string;
        if (from?.zone === '手牌' && from?.player !== undefined) {
          const fromP = viewPlayer(view, from.player);
          if (fromP) {
            removeCardFromHand(fromP, cardId);
          }
        }
        if (to?.zone === '手牌' && to?.player !== undefined) {
          addCardToHand(view, to.player, cardId);
        }
        break;
      }
    }
  },
};
