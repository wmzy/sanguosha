// src/engine/atoms/拼点.ts
// 拼点:事件标记(拼点结果由后端 + 钩子处理)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 拼点: AtomDefinition<{
  initiator: number; target: number; initiatorCard: string; targetCard: string;
}> = {
  type: '拼点',
  validate(state, atom) {
    if (!state.players[atom.initiator]) return `initiator not found`;
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply(_state) {
    // 事件标记——拼点结果由后端 + 钩子处理
  },
  effect: { sound: 'pindian', animation: 'flip', duration: 800 },
};

registerAtom(拼点);
