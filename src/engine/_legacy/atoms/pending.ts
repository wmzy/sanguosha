// @ts-nocheck
import type { GameState, Atom, PendingAction } from '../types';
import { registerAtom } from '../atom';

export function createPendingId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function register() {
  registerAtom({
    type: '推入待定',
    apply(state: GameState, atom: Atom & { type: '推入待定'; action: PendingAction }) {
      const action = atom.action.id ? atom.action : { ...atom.action, id: createPendingId() };
      return { ...state, pending: action };
    },
  });

  registerAtom({
    type: '弹出待定',
    apply(state: GameState, _atom: Atom & { type: '弹出待定' }) {
      return { ...state, pending: null };
    },
  });
}
