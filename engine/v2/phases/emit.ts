import type { SkillPhase, PhaseDefinition, GameState, SkillContext, EngineResult } from '../types';
import { registerPhase } from '../phase';

type EmitPhase = Extract<SkillPhase, { type: 'emit' }>;

registerPhase<EmitPhase>({
  type: 'emit',
  execute(state: GameState, phase: EmitPhase, ctx: SkillContext, plan: SkillPhase[], index: number): EngineResult {
    return { state, events: [] };
  },
});
