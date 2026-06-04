import type { GameState, Atom, AtomEventResult, PendingAction, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';
import { asJson } from '../../shared/typeGuards';

export function createPendingId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function register() {
  registerAtom({
    type: 'pushPending',
    apply(state: GameState, atom: Atom & { type: 'pushPending'; action: PendingAction }) {
      const action = atom.action.id ? atom.action : { ...atom.action, id: createPendingId() };
      return { ...state, pending: action };
    },
    toEvents(_state: GameState, atom: Atom & { type: 'pushPending'; action: PendingAction }): AtomEventResult {
      const action = atom.action.id ? atom.action : { ...atom.action, id: createPendingId() };
      const server = makeServerEvent('pushPending', asJson(action));
      return [server, new Map(), null];
    },
  });

  registerAtom({
    type: 'popPending',
    apply(state: GameState, _atom: Atom & { type: 'popPending' }) {
      return { ...state, pending: null };
    },
    toEvents(_state: GameState, _atom: Atom & { type: 'popPending' }): AtomEventResult {
      const server = makeServerEvent('popPending', {});
      return [server, new Map(), null];
    },
  });
}
