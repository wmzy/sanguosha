// src/engine/atoms/指定目标.ts
// 指定目标:事件标记(目标关系在事件流中记录)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 指定目标: AtomDefinition<{ source: number; cardId?: string; target: number }> = {
  type: '指定目标',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply(_state) {
    // 事件标记——目标关系在事件流中记录
  },
  effect: { sound: 'target', animation: 'highlight', duration: 200 },
};

registerAtom(指定目标);
