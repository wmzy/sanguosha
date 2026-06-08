import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';
import { updatePlayer } from '../state';
import type { PendingTrick } from '../../shared/types';

export function register() {
  registerAtom({
    type: '添加延时锦囊',
    apply(state: GameState, atom: Atom & { type: '添加延时锦囊'; trick: PendingTrick }) {
      const player = atom.player as string;
      return updatePlayer(state, player, p => ({
        pendingTricks: [...p.pendingTricks, atom.trick],
      }));
    },
  });

  registerAtom({
    type: '移除延时锦囊',
    apply(state: GameState, atom: Atom & { type: '移除延时锦囊'; index: number }) {
      const player = atom.player as string;
      return updatePlayer(state, player, p => ({
        pendingTricks: p.pendingTricks.filter((_, i) => i !== atom.index),
      }));
    },
  });
}
