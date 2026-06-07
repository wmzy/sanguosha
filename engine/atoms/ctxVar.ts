import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';

type SetCtxVarAtom = Extract<Atom, { type: '设置上下文变量' }>;

export function register() {
  registerAtom({
    type: '设置上下文变量',
    apply(state: GameState, _atom: Atom) {
      return state;
    },
    toEvents(_state: GameState, atom: SetCtxVarAtom): AtomEventResult {
      const payload: Json = { key: atom.key, value: atom.value };
      const server = makeServerEvent('设置上下文变量', payload);
      return [server, new Map(), null] as const;
    },
  });
}
