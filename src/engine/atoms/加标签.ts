// src/engine/atoms/加标签.ts
// 加标签:为玩家加 tag(写入 player.tags 数组)
import type { AtomDefinition } from '../types';
import { broadcast, requirePlayer, viewPlayer } from './_helpers';

export const 加标签: AtomDefinition<{ player: number; tag: string }> = {
  type: '加标签',
  validate(state, atom) {
    return requirePlayer(state, atom.player, 'player');
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    if (!player.tags.includes(atom.tag)) player.tags.push(atom.tag);
  },
  toViewEvents(_state, atom) {
    return broadcast({ type: '加标签', player: atom.player, tag: atom.tag });
  },
  applyView(view, event) {
    const player = viewPlayer(view, event.player as number);
    if (!player) return;
    const tags = (player.tags ??= []);
    const tag = event.tag as string;
    if (!tags.includes(tag)) tags.push(tag);
  },
};

