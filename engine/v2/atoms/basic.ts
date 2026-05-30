import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

registerAtom({
  type: 'damage',
  apply(state: GameState, atom: Atom & { type: 'damage' }) {
    const target = atom.target as string;
    const amount = atom.amount as number;
    return updatePlayer(state, target, p => ({
      health: Math.max(0, p.health - amount),
    }));
  },
  toEvents(state: GameState, atom: Atom & { type: 'damage' }): AtomEventResult {
    const target = atom.target as string;
    const amount = atom.amount as number;
    const source = atom.source as string | undefined;
    const cardId = atom.cardId as string | undefined;
    const payload: Json = { target, amount, ...(source ? { source } : {}), ...(cardId ? { cardId } : {}) };
    const server = makeServerEvent('damage', payload);
    return [server, new Map(), makePlayerEvent('damage', payload)];
  },
});

registerAtom({
  type: 'heal',
  apply(state: GameState, atom: Atom & { type: 'heal' }) {
    const target = atom.target as string;
    const amount = atom.amount as number;
    return updatePlayer(state, target, p => ({
      health: Math.min(p.maxHealth, p.health + amount),
    }));
  },
  toEvents(state: GameState, atom: Atom & { type: 'heal' }): AtomEventResult {
    const target = atom.target as string;
    const amount = atom.amount as number;
    const source = atom.source as string | undefined;
    const payload: Json = { target, amount, ...(source ? { source } : {}) };
    const server = makeServerEvent('heal', payload);
    return [server, new Map(), makePlayerEvent('heal', payload)];
  },
});

registerAtom({
  type: 'draw',
  apply(state: GameState, atom: Atom & { type: 'draw' }) {
    const player = atom.player as string;
    const count = atom.count as number;
    const drawn = state.zones.deck.slice(0, count);
    const remaining = state.zones.deck.slice(count);
    return updatePlayer(
      { ...state, zones: { ...state.zones, deck: remaining } },
      player,
      p => ({ hand: [...p.hand, ...drawn] }),
    );
  },
  toEvents(state: GameState, atom: Atom & { type: 'draw' }): AtomEventResult {
    const player = atom.player as string;
    const count = atom.count as number;
    const drawn = state.zones.deck.slice(0, count);
    const server = makeServerEvent('draw', { player, count, cards: drawn } as Json);
    const ownerEvent = makePlayerEvent('draw', { player, count, cards: drawn } as Json);
    const defaultEvent = makePlayerEvent('draw', { player, count } as Json);
    return [server, new Map([[player, ownerEvent]]), defaultEvent];
  },
});

registerAtom({
  type: 'discard',
  apply(state: GameState, atom: Atom & { type: 'discard' }) {
    const player = atom.player as string;
    const cardIds = atom.cardIds as string[];
    const cardIdSet = new Set(cardIds);
    return updatePlayer(state, player, p => ({
      hand: p.hand.filter(id => !cardIdSet.has(id)),
    }));
  },
  toEvents(state: GameState, atom: Atom & { type: 'discard' }): AtomEventResult {
    const player = atom.player as string;
    const cardIds = atom.cardIds as string[];
    const payload: Json = { player, cardIds };
    const server = makeServerEvent('discard', payload);
    return [server, new Map(), makePlayerEvent('discard', payload)];
  },
});

registerAtom({
  type: 'moveCard',
  apply(state: GameState, atom: Atom & { type: 'moveCard' }) {
    const cardId = atom.cardId as string;
    const { from, to } = atom;

    let s: GameState = { ...state };

    if (from.zone === 'hand') {
      s = updatePlayer(s, from.player, p => ({
        hand: p.hand.filter(id => id !== cardId),
      }));
    } else if (from.zone === 'discardPile') {
      s = { ...s, zones: { ...s.zones, discardPile: s.zones.discardPile.filter(id => id !== cardId) } };
    } else if (from.zone === 'deck') {
      s = { ...s, zones: { ...s.zones, deck: s.zones.deck.filter(id => id !== cardId) } };
    } else if (from.zone === 'equipment') {
      s = updatePlayer(s, from.player, p => {
        const eq = { ...p.equipment };
        delete eq[from.slot];
        return { equipment: eq };
      });
    }

    if (to.zone === 'hand') {
      s = updatePlayer(s, to.player, p => ({ hand: [...p.hand, cardId] }));
    } else if (to.zone === 'discardPile') {
      s = { ...s, zones: { ...s.zones, discardPile: [...s.zones.discardPile, cardId] } };
    } else if (to.zone === 'deck') {
      s = { ...s, zones: { ...s.zones, deck: [...s.zones.deck, cardId] } };
    } else if (to.zone === 'equipment') {
      s = updatePlayer(s, to.player, p => ({
        equipment: { ...p.equipment, [to.slot]: cardId },
      }));
    }

    return s;
  },
  toEvents(state: GameState, atom: Atom & { type: 'moveCard' }): AtomEventResult {
    const cardId = atom.cardId as string;
    const payload: Json = { cardId, from: atom.from as unknown as Json, to: atom.to as unknown as Json };
    const server = makeServerEvent('moveCard', payload);
    return [server, new Map(), makePlayerEvent('moveCard', payload)];
  },
});
