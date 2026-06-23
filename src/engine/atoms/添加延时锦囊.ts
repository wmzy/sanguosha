// src/engine/atoms/添加延时锦囊.ts
// 添加延时锦囊:在玩家判定区放置延时锦囊
import type { AtomDefinition, PendingTrick, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 添加延时锦囊: AtomDefinition<{ player: number; trick: PendingTrick }> = {
  type: '添加延时锦囊',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    if (player.pendingTricks.some(t => t.name === atom.trick.name)) return;
    player.pendingTricks.push(atom.trick);
  },
  effect: { sound: 'judge_attach', animation: 'glow', duration: 800 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '添加延时锦囊',
      player: atom.player,
      trickName: atom.trick.name,
      trick: atom.trick,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const pi = view.players.findIndex(p => p.index === (event.player as number));
    if (pi < 0) return;
    if (!view.players[pi].pendingTricks) {
      view.players[pi].pendingTricks = [];
    }
    // trick 是 PendingTrick{ name, source, card };GameView 仅存 cardId
    const trick = event.trick as { name?: string; card?: { id: string } } | undefined;
    if (trick?.card?.id) {
      const list = view.players[pi].pendingTricks!;
      const cardId = trick.card.id;
      if (!list.includes(cardId)) list.push(cardId);
    }
  },
  toViewLog(event) {
    const trick = event.trick as { name?: string } | undefined;
    return { player: event.player as number, text: `判定区放入 ${trick?.name ?? '延时锦囊'}` };
  },
};

registerAtom(添加延时锦囊);
