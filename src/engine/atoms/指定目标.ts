// src/engine/atoms/指定目标.ts
// 指定目标:事件标记(目标关系在事件流中记录)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 指定目标: AtomDefinition<{ source: string; cardId?: string; target: string }> = {
  type: '指定目标',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.source)) return `source ${atom.source} not found`;
    if (!state.players.find(p => p.name === atom.target)) return `target ${atom.target} not found`;
    return null;
  },
  apply(state) { return { ...state }; },
  effect: { sound: 'target', animation: 'highlight', duration: 200 },
};

registerAtom(指定目标);
