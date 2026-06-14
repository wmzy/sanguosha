// src/engine/atoms/击杀.ts
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 击杀: AtomDefinition<{ player: number }> = {
  type: '击杀',
  validate(state, atom) {
    const p = state.players[atom.player];
    if (!p) return `player ${atom.player} not found`;
    if (p.alive) return 'player still alive';
    return null;
  },
  apply(_state, _atom) {
    // 击杀本身不修改 state,只是事件标记
  },
  effect: { sound: 'death', animation: 'fade', duration: 1000 },
};

registerAtom(击杀);
