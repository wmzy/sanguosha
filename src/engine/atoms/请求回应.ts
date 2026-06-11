// src/engine/atoms/请求回应.ts
// 请求回应:通用等待型 atom — 等待 target 玩家回应
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
  pending: {
    getTarget: (atom) => (atom as { target: string }).target,
    timeout: 30,
  },
  effect: { blockUntilDone: true, duration: 200 },
};

registerAtom(请求回应);
