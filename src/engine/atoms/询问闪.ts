// src/engine/atoms/询问闪.ts
// 询问闪:等待 target 出闪(awaits 在 PR 4 接入)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 询问闪: AtomDefinition<{ target: string; source: string }> = {
  type: '询问闪',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.target)) return `target not found`;
    return null;
  },
  apply(state) { return { ...state }; },
  effect: { sound: 'dodge_request', blockUntilDone: true, duration: 200 },
};

registerAtom(询问闪);
