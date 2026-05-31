import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';

export function register() {
  registerAtom({
    type: 'setCtxVar',
    apply(state: GameState, _atom: Atom) {
      return state;
    },
    toEvents(_state: GameState, atom: Atom): AtomEventResult {
      const a = atom as unknown as { type: 'setCtxVar'; key: string; value: Json };
      const payload: Json = { key: a.key, value: a.value };
      const server = makeServerEvent('setCtxVar', payload);
      return [server, new Map(), null] as const;
    },
  });
}
