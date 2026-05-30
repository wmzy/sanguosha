import type { GameState, Atom, AtomEventResult, PendingAction, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';

registerAtom({
  type: 'pushPending',
  apply(state: GameState, atom: Atom & { type: 'pushPending'; action: PendingAction }) {
    return { ...state, pending: atom.action };
  },
  toEvents(state: GameState, atom: Atom & { type: 'pushPending' }): AtomEventResult {
    const server = makeServerEvent('pushPending', { type: 'pushPending' } as Json);
    return [server, new Map(), null];
  },
});

registerAtom({
  type: 'popPending',
  apply(state: GameState, _atom: Atom & { type: 'popPending' }) {
    return { ...state, pending: null };
  },
  toEvents(state: GameState, _atom: Atom & { type: 'popPending' }): AtomEventResult {
    const server = makeServerEvent('popPending', {} as Json);
    return [server, new Map(), null];
  },
});
