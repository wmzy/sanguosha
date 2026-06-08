import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: '加标签',
    apply(state: GameState, atom: Atom & { type: '加标签' }) {
      const player = atom.player as string;
      const { tag } = atom;
      return updatePlayer(state, player, p => {
        if (p.tags.includes(tag)) return p;
        return { tags: [...p.tags, tag] };
      });
    },
  });

  registerAtom({
    type: '去标签',
    apply(state: GameState, atom: Atom & { type: '去标签' }) {
      const player = atom.player as string;
      const { tag } = atom;
      return updatePlayer(state, player, p => ({
        tags: p.tags.filter(t => t !== tag),
      }));
    },
  });
}
