// src/engine/atoms/去标签.ts
// 去标签:移除玩家的 tag(从 player.tags 数组)
import type { AtomDefinition } from '../types';

export const 去标签: AtomDefinition<{ player: number; tag: string }> = {
  type: '去标签',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(state, atom) {
    const player = state.players[atom.player];
    player.tags = player.tags.filter((t) => t !== atom.tag);
  },
  toViewEvents(_state, atom) {
    return {
      ownerViews: new Map(),
      othersView: { type: '去标签', player: atom.player, tag: atom.tag },
    };
  },
  applyView(view, event) {
    const player = view.players.find((p) => p.index === event.player);
    if (player) player.tags = (player.tags ?? []).filter((tag) => tag !== event.tag);
  },
};

