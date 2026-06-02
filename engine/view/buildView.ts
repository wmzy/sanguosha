// engine/view/buildView.ts — 从 GameState 构造 PlayerView
//
// 服务端在玩家加入/重连时调用此函数生成 initialView。客户端不需要此函数
// （客户端通过 reducer 从 events 重建 PlayerView），但类型 PlayerView 在
// engine/view/types 中已定义，buildView 依赖之。

import type { GameState, PendingAction } from '../types';
import type {
  PlayerView,
  SelfView,
  OtherPlayerView,
  CardInfo,
  TableView,
  TurnView,
} from './types';

export function buildPlayerView(state: GameState, myPlayerId: string): PlayerView {
  const self = state.players[myPlayerId];
  if (!self) {
    throw new Error(`buildPlayerView: unknown player "${myPlayerId}"`);
  }

  const selfView: SelfView = {
    characterId: self.info.characterId,
    hand: self.hand.map(id => toCardInfo(state, id)),
    equipment: {
      weapon: self.equipment.weapon ? toCardInfo(state, self.equipment.weapon) : null,
      armor: self.equipment.armor ? toCardInfo(state, self.equipment.armor) : null,
      mount: (self.equipment.horsePlus ?? self.equipment.horseMinus)
        ? toCardInfo(state, (self.equipment.horsePlus ?? self.equipment.horseMinus)!)
        : null,
    },
    health: self.health,
    maxHealth: self.maxHealth,
    pendingTricks: self.pendingTricks.map(t => ({ name: t.name, source: t.source, cardId: t.card.id })),
    tags: [...self.tags],
    vars: { ...self.vars },
    alive: self.info.alive,
  };

  const others: Record<string, OtherPlayerView> = {};
  for (const name of state.playerOrder) {
    if (name === myPlayerId) continue;
    const p = state.players[name];
    if (!p) continue;
    others[name] = {
      characterId: p.info.characterId,
      handCount: p.hand.length,
      equipment: {
        weapon: p.equipment.weapon ? toCardInfo(state, p.equipment.weapon) : null,
        armor: p.equipment.armor ? toCardInfo(state, p.equipment.armor) : null,
        mount: (p.equipment.horsePlus ?? p.equipment.horseMinus)
          ? toCardInfo(state, (p.equipment.horsePlus ?? p.equipment.horseMinus)!)
          : null,
      },
      health: p.health,
      maxHealth: p.maxHealth,
      pendingTrickCount: p.pendingTricks.length,
      alive: p.info.alive,
    };
  }

  const table: TableView = {
    discardPileCount: state.zones.discardPile.length,
    deckCount: state.zones.deck.length,
  };

  const turn: TurnView = {
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    killsPlayed: state.turn.killsPlayed,
  };

  const cardMap: Record<string, CardInfo> = {};
  for (const [id, c] of Object.entries(state.cardMap)) {
    cardMap[id] = toCardInfoFromCard(c);
  }

  return {
    cardMap,
    self: selfView,
    others,
    table,
    turn,
    pending: state.pending,
  };
}

function toCardInfo(state: GameState, cardId: string): CardInfo {
  const c = state.cardMap[cardId];
  if (!c) {
    return { id: cardId, name: '', type: '基本牌', subtype: '杀', suit: '♠', rank: 'A', description: '' };
  }
  return toCardInfoFromCard(c);
}

function toCardInfoFromCard(c: GameState['cardMap'][string]): CardInfo {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    subtype: c.subtype,
    suit: c.suit,
    rank: c.rank,
    description: c.description,
  };
}

export function toCardInfoMap(cards: GameState['cardMap']): Record<string, CardInfo> {
  const map: Record<string, CardInfo> = {};
  for (const [id, c] of Object.entries(cards)) {
    map[id] = toCardInfoFromCard(c);
  }
  return map;
}

/** 深拷贝 PlayerView（用于 reducer immutable 更新）。 */
export function clonePlayerView(view: PlayerView): PlayerView {
  return JSON.parse(JSON.stringify(view)) as PlayerView;
}

export type { PendingAction };
