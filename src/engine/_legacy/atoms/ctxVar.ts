// @ts-nocheck
import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';

type SetCtxVarAtom = Extract<Atom, { type: '设置上下文变量' }>;

export function register() {
  registerAtom({
    type: '设置上下文变量',
    apply(state: GameState, _atom: Atom) {
      return state;
    },
  });
}
