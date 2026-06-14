// src/engine/atoms/判定.ts
// 判定:事件标记(具体判定结果由后端随机 + 钩子处理)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 判定: AtomDefinition<{ player: number; judgeType: string }> = {
  type: '判定',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(_state) {
    // 事件标记——具体判定结果由后端随机 + 钩子处理
  },
  effect: { sound: 'judge', animation: 'flip', blockUntilDone: true, duration: 600 },
};

registerAtom(判定);
