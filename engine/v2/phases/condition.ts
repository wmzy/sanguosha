import type { SkillPhase, PhaseDefinition, GameState, SkillContext, EngineResult } from '../types';
import { registerPhase, executePlan } from '../phase';
import { checkCondition } from '../expr';

type ConditionPhase = Extract<SkillPhase, { type: 'condition' }>;

registerPhase<ConditionPhase>({
  type: 'condition',
  execute(state: GameState, phase: ConditionPhase, ctx: SkillContext, plan: SkillPhase[], index: number): EngineResult {
    if (checkCondition(phase.check, state, ctx)) {
      return executePlan(state, phase.then, ctx);
    }
    if (phase.else) {
      return executePlan(state, phase.else, ctx);
    }
    return { state, events: [] };
  },
});
