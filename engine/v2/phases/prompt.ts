import type { SkillPhase, PhaseDefinition, GameState, SkillContext, EngineResult, PendingSkillPrompt } from '../types';
import { registerPhase } from '../phase';

type PromptPhase = Extract<SkillPhase, { type: 'prompt' }>;

registerPhase<PromptPhase>({
  type: 'prompt',
  execute(state: GameState, phase: PromptPhase, ctx: SkillContext, plan: SkillPhase[], index: number): EngineResult {
    const timeout = phase.timeout ?? 15000;
    const pending: PendingSkillPrompt = {
      type: 'skillPrompt',
      skillId: ctx.skillId,
      player: ctx.self,
      execution: { phaseIndex: index + 1, ctx },
      prompt: {
        text: phase.text,
        options: phase.options,
        defaultChoice: phase.defaultChoice,
        timeout,
      },
      timeout,
      deadline: Date.now() + timeout,
      onTimeout: { type: 'skillChoice', player: ctx.self, choice: phase.defaultChoice ?? null },
    };
    return { state: { ...state, pending }, events: [] };
  },
});
