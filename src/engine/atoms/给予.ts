// src/engine/atoms/给予.ts
// 给予:从 from 玩家手牌将 cardId 给予 to 玩家
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 给予: AtomDefinition<{ cardId: string; from: number; to: number }> = {
  type: '给予',
  validate(state, atom) {
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    const fromP = state.players[atom.from];
    if (!fromP) return `from ${atom.from} not found`;
    if (!fromP.hand.includes(atom.cardId)) return `card not in from's hand`;
    if (!state.players[atom.to]) return `to ${atom.to} not found`;
    return null;
  },
  apply(state, atom) {
    const fromIdx = atom.from;
    const toIdx = atom.to;
    state.players[fromIdx].hand = state.players[fromIdx].hand.filter((id) => id !== atom.cardId);
    state.players[toIdx].hand.push(atom.cardId);
  },
  effect: { sound: 'give', animation: 'slide', duration: 600 },
  toViewEvents(_state, atom): ViewEventSplit {
    const effect = { sound: 'give' as const, animation: 'slide' as const, duration: 600 };
    // toViewEvents 在 apply 之前调用,此时 cardId 还在 from 手牌里。
    // ownerView (from+to):都应看到 cardId 和牌名(从谁给到谁,什么牌)
    const ownerView: ViewEvent = {
      type: '给予',
      cardId: atom.cardId,
      cardName: _state.cardMap[atom.cardId]?.name,
      from: atom.from,
      to: atom.to,
      effect,
    };
    // othersView:第三方只看到「谁给了谁一张牌」,不暴露 cardId
    const othersView: ViewEvent = {
      type: '给予',
      from: atom.from,
      to: atom.to,
      effect,
    };
    return {
      ownerViews: new Map([
        [atom.from, ownerView],
        [atom.to, ownerView],
      ]),
      othersView,
    };
  },
  applyView(view, event) {
    const cardId = event.cardId as string | undefined;
    const fromPi = view.players.findIndex((p) => p.index === (event.from as number));
    if (fromPi >= 0) {
      view.players[fromPi].handCount = Math.max(0, view.players[fromPi].handCount - 1);
      if (cardId && view.players[fromPi].hand) {
        view.players[fromPi].hand = view.players[fromPi].hand.filter((c) => c.id !== cardId);
      }
    }
    const toPi = view.players.findIndex((p) => p.index === (event.to as number));
    if (toPi >= 0) {
      view.players[toPi].handCount += 1;
      if (cardId && view.players[toPi].hand) {
        const card = view.cardMap[cardId];
        if (card) view.players[toPi].hand.push(card);
      }
    }
  },
  toViewLog(event, viewer) {
    const from = event.from as number;
    const to = event.to as number;
    const cardName = event.cardName as string | undefined;
    // owner 视角(from+to)能看到具体牌面
    const isOwner = from === viewer || to === viewer;
    if (isOwner && cardName) {
      return { player: from, text: `将 ${cardName} 给予了 P${to}` };
    }
    return { player: from, text: `给 P${to} 一张牌` };
  },
};

registerAtom(给予);
