// src/engine/atoms/添加延时锦囊.ts
// 添加延时锦囊:在玩家判定区放置延时锦囊
import type { AtomDefinition, PendingTrick, ViewEventSplit, ViewEvent } from '../types';
import { broadcast, requirePlayer, viewPlayer } from './_helpers';

export const 添加延时锦囊: AtomDefinition<{ player: number; trick: PendingTrick }> = {
  type: '添加延时锦囊',
  validate(state, atom) {
    return requirePlayer(state, atom.player, 'player');
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    if (player.pendingTricks.some((t) => t.name === atom.trick.name)) return;
    player.pendingTricks.push(atom.trick);
  },
  effect: { sound: 'flip', animation: 'glow', duration: 800 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '添加延时锦囊',
      player: atom.player,
      trickName: atom.trick.name,
      trick: atom.trick,
    };
    return broadcast(view);
  },
  applyView(view, event) {
    const p = viewPlayer(view, event.player as number);
    if (!p) return;
    p.pendingTricks ??= [];
    // trick 是 PendingTrick{ name, source, card };GameView 仅存 cardId
    const trick = event.trick as { name?: string; card?: { id: string } } | undefined;
    if (trick?.card?.id) {
      const list = p.pendingTricks;
      const cardId = trick.card.id;
      if (!list.includes(cardId)) list.push(cardId);
    }
  },
  toViewLog(event) {
    const trick = event.trick as { name?: string } | undefined;
    return { player: event.player as number, text: `判定区放入 ${trick?.name ?? '延时锦囊'}` };
  },
};

