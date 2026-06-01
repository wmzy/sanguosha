import type { SkillPhase, GameState, SkillContext, EngineResult } from '../types';
import { registerPhase } from '../phase';
import { emitEvent } from '../skill';

type EmitPhase = Extract<SkillPhase, { type: 'emit' }>;

export function register() {
  registerPhase<EmitPhase>({
    type: 'emit',
    execute(state: GameState, phase: EmitPhase, _ctx: SkillContext, _plan: SkillPhase[], _index: number): EngineResult {
      return emitEvent(state, phase.event);
    },
  });
}
