// src/engine/atoms/阶段结束.ts
// 阶段结束:事件标记
import type { AtomDefinition, GameView, TurnPhase } from '../types';
import { registerAtom } from '../atom';

export const 阶段结束: AtomDefinition<{ player: number; phase: string }> = {
  type: '阶段结束',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply(_state) {
    // 事件标记
  },
  effect: { sound: 'phase_end', duration: 600 },
  applyView(view: GameView, event) {
    // apply 是事件标记(state.phase 不变),仅当 event.phase 与当前视角阶段不一致时才更新
    const phase = event.phase as TurnPhase;
    if (view.phase !== phase) {
      view.phase = phase;
    }
  },
};

registerAtom(阶段结束);
