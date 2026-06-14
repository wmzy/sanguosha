// src/engine/atoms/添加延时锦囊.ts
// 添加延时锦囊:在玩家判定区放置延时锦囊
import type { AtomDefinition, PendingTrick } from '../types';
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
};

registerAtom(添加延时锦囊);
