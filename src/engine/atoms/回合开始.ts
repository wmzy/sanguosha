// src/engine/atoms/回合开始.ts
// 回合开始:事件标记(具体状态变更由前置 apply 处理)
import type { AtomDefinition, GameView } from '../types';
import { registerAtom } from '../atom';

export const 回合开始: AtomDefinition<{ player: number }> = {
  type: '回合开始',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(_state) {
    // 事件标记——具体状态变更由前置 apply 处理
  },
  effect: { sound: 'turn_start', duration: 1500 },
  applyView(view: GameView, event) {
    view.currentPlayerIndex = event.player as number;
  },
};

registerAtom(回合开始);
