// src/engine/atoms/请求回应.ts
// 请求回应:通用等待回应(confirm/distribute/choosePlayer 等)
import type { ActionPrompt, AtomDefinition, GameState, Json } from '../types';
import { registerAtom } from '../atom';

export const 请求回应: AtomDefinition<{
  requestType: string;
  target: string;
  prompt: ActionPrompt;
  defaultChoice?: Json;
  timeout?: number;
}> = {
  type: '请求回应',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.target)) return `target not found`;
    return null;
  },
  apply(state) { return { ...state }; },
  effect: { blockUntilDone: true, duration: 200 },
};

registerAtom(请求回应);
