import type { AtomDefinition, Card, GameView, ViewEvent, ViewEventSplit } from '../types';

/** 将技能标记指向的单张暂存牌返还手牌或弃置。 */
export const 移动暂存牌: AtomDefinition<{
  player: number;
  varsKey: string;
  cardId: string;
  to: '手牌' | '弃牌堆';
}> = {
  type: '移动暂存牌',
  validate(state, atom) {
    const player = state.players[atom.player];
    if (!player) return `player ${atom.player} not found`;
    if (typeof atom.varsKey !== 'string' || atom.varsKey.length === 0) return 'varsKey 不能为空';
    const stored = player.vars[atom.varsKey];
    if (!Array.isArray(stored) || !stored.includes(atom.cardId)) return '牌不在暂存区';
    if (!state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    const stored = player.vars[atom.varsKey] as string[];
    player.vars[atom.varsKey] = stored.filter((id) => id !== atom.cardId);
    if ((player.vars[atom.varsKey] as string[]).length === 0) delete player.vars[atom.varsKey];
    if (atom.to === '手牌') player.hand.push(atom.cardId);
    else state.zones.discardPile.push(atom.cardId);
  },
  toViewEvents(state, atom): ViewEventSplit {
    const card = state.cardMap[atom.cardId];
    const event: ViewEvent = {
      type: '移动暂存牌',
      player: atom.player,
      cardId: atom.cardId,
      to: atom.to,
      ...(atom.to === '弃牌堆' && card
        ? { card: { id: card.id, name: card.name, suit: card.suit, rank: card.rank } }
        : {}),
    };
    if (atom.to === '弃牌堆') return { ownerViews: new Map(), othersView: event };
    const ownerEvent: ViewEvent = {
      ...event,
      card: card ? { id: card.id, name: card.name, suit: card.suit, rank: card.rank } : undefined,
    };
    return { ownerViews: new Map([[atom.player, ownerEvent]]), othersView: event };
  },
  applyView(view: GameView, event: ViewEvent) {
    const playerIndex = view.players.findIndex((player) => player.index === event.player);
    if (playerIndex < 0) return;
    const id = event.cardId as string;
    const to = event.to as '手牌' | '弃牌堆';
    if (to === '弃牌堆') {
      if (view.zones) view.zones.discardPileCount += 1;
      return;
    }
    view.players[playerIndex].handCount += 1;
    const card = event.card as Card | undefined;
    if (card && view.players[playerIndex].hand) {
      const known = view.cardMap[id] ?? card;
      view.players[playerIndex].hand.push(known);
      view.cardMap[id] = known;
    }
  },
};
