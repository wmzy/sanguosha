import type { GameState, Atom, AtomEventResult, PendingAction, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';
import { asJson } from '../../shared/typeGuards';

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
    toEvents(_state: GameState, atom: Atom & { type: '推入待定'; action: PendingAction }): AtomEventResult {
      const action = atom.action.id ? atom.action : { ...atom.action, id: createPendingId() };
      const server = makeServerEvent('推入待定', asJson(action));
      return [server, new Map(), null];
    },
  });

  registerAtom({
    type: '弹出待定',
    apply(state: GameState, _atom: Atom & { type: '弹出待定' }) {
      return { ...state, pending: null };
    },
    toEvents(_state: GameState, _atom: Atom & { type: '弹出待定' }): AtomEventResult {
      const server = makeServerEvent('弹出待定', {});
      return [server, new Map(), null];
    },
  });
}
