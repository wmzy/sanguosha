// src/engine/atoms/阶段结束.ts
// 阶段结束:事件标记
import type { AtomDefinition, GameView, TurnPhase, ViewEventSplit, ViewEvent } from '../types';
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
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '阶段结束',
      player: atom.player,
      phase: atom.phase,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  effect: { sound: 'phase_end', duration: 600 },
  applyView(view: GameView, event) {
    // apply 是事件标记(state.phase 不变),仅当 event.phase 与当前视角阶段不一致时才更新
    const phase = event.phase as TurnPhase;
    if (view.phase !== phase) {
      view.phase = phase;
    }
  },
  toViewLog(event) {
    return { player: event.player as number, text: `${event.phase}阶段结束` };
  },
};

registerAtom(阶段结束);
