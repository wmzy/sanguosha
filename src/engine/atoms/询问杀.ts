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
  pending: {
    onTimeout: { type: '无操作' },
    prompt: { type: 'useCard', title: '是否出杀', cardFilter: { filter: c => c.name === '杀', min: 1, max: 1 } },
    timeout: 15,
  },
  effect: { sound: 'slash_request', blockUntilDone: true, duration: 200 },
};

registerAtom(询问杀);
