// src/engine/atoms/询问闪.ts
// 询问闪:等待型 atom — 等待 target 出闪
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 询问闪: AtomDefinition<{ target: string; source: string }> = {
  type: '询问闪',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.target)) return `target not found`;
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  pending: {
    onTimeout: { type: '无操作' },
    prompt: { type: 'useCard', title: '是否出闪', cardFilter: { filter: c => c.name === '闪', min: 1, max: 1 } },
    timeout: 15,
  },
  effect: { sound: 'dodge_request', blockUntilDone: true, duration: 200 },
};

registerAtom(询问闪);
