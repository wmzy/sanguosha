// src/engine/atoms/阶段开始.ts
// 阶段开始:更新 state.phase
import type { AtomDefinition, GameView, TurnPhase, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

const VALID_PHASES: TurnPhase[] = ['准备', '判定', '摸牌', '出牌', '弃牌', '回合结束'];

export const 阶段开始: AtomDefinition<{ player: number; phase: string }> = {
  type: '阶段开始',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    if (!VALID_PHASES.includes(atom.phase as TurnPhase)) return `invalid phase ${atom.phase}`;
    return null;
  },
  apply(state, atom) {
    const phase = atom.phase as TurnPhase;
    state.phase = phase;
    state.turn.phase = phase;
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '阶段开始',
      player: atom.player,
      phase: atom.phase,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  effect: { sound: 'phase_start', duration: 1000 },
  applyView(view: GameView, event) {
    view.phase = event.phase as TurnPhase;
    view.turn.phase = event.phase as TurnPhase;
  },
  toViewLog(event) {
    return { player: event.player as number, text: `${event.phase}阶段开始` };
  },
};

registerAtom(阶段开始);
