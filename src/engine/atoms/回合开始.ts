// src/engine/atoms/回合开始.ts
// 回合开始:事件标记(具体状态变更由前置 apply 处理)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 回合开始: AtomDefinition<{ player: string }> = {
  type: '回合开始',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.player)) return `player ${atom.player} not found`;
    return null;
  },
  apply(state) { return { ...state }; },
  effect: { sound: 'turn_start', duration: 200 },
};

registerAtom(回合开始);
