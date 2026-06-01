import type { SkillPhase, GameState, SkillContext, EngineResult, ServerEvent } from '../types';
import { registerPhase, executePlan } from '../phase';
import { resolve } from '../expr';

type ForeachPhase = Extract<SkillPhase, { type: 'foreach' }>;

export function register() {
  registerPhase<ForeachPhase>({
    type: 'foreach',
    execute(state: GameState, phase: ForeachPhase, ctx: SkillContext, _plan: SkillPhase[], _index: number): EngineResult {
      let s = state;
      const events: ServerEvent[] = [];
      const collection = resolve<string[]>(phase.collection, s, ctx);

      for (const item of collection) {
        const innerCtx = { ...ctx, localVars: { ...ctx.localVars, [phase.varName]: item } };
        const result = executePlan(s, phase.body, innerCtx);
        s = result.state;
        events.push(...result.events);
        if (s.pending !== null) {
          return { state: s, events };
        }
      }

      return { state: s, events };
    },
  });
}
