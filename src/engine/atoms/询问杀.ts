// src/engine/atoms/询问杀.ts
// 询问杀:等待型 atom — 等待 target 出杀
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 询问杀: AtomDefinition<{ target: string; source: string }> = {
  type: '询问杀',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.target)) return `target not found`;
    return null;
  },
  apply(state) { return { ...state }; },
  pending: { getTarget: (atom) => (atom as { target: string }).target },
  effect: { sound: 'slash_request', blockUntilDone: true, duration: 200 },
};

registerAtom(询问杀);
