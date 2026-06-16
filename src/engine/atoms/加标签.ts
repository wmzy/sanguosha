// src/engine/atoms/加标签.ts
// 加标签:为玩家加 tag(写入 player.tags 数组)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 加标签: AtomDefinition<{ player: number; tag: string }> = {
  type: '加标签',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    if (!player.tags) player.tags = [];
    if (!player.tags.includes(atom.tag)) player.tags.push(atom.tag);
  },
};

registerAtom(加标签);
