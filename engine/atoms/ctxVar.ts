import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';

type SetCtxVarAtom = Extract<Atom, { type: 'setCtxVar' }>;

export function register() {
  registerAtom({
    type: 'setCtxVar',
    apply(state: GameState, _atom: Atom) {
      return state;
    },
    toEvents(_state: GameState, atom: SetCtxVarAtom): AtomEventResult {
      const payload: Json = { key: atom.key, value: atom.value };
      const server = makeServerEvent('setCtxVar', payload);
      return [server, new Map(), null] as const;
    },
  });
}
