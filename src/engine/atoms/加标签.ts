// src/engine/atoms/加标签.ts
// 加标签:为玩家加 tag(实现为 mark id='tag:<name>')
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
    if (player.marks.some(m => m.id === `tag:${atom.tag}`)) return;
    player.marks.push({ id: `tag:${atom.tag}`, scope: player.index });
  },
};

registerAtom(加标签);
