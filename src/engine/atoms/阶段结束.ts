// src/engine/atoms/阶段结束.ts
// 阶段结束:事件标记
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 阶段结束: AtomDefinition<{ player: string; phase: string }> = {
  type: '阶段结束',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.player)) return `player ${atom.player} not found`;
    return null;
  },
  apply(_state) {
    // 事件标记
  },
  effect: { sound: 'phase_end', duration: 150 },
};

registerAtom(阶段结束);
