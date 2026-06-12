// @ts-nocheck
import type { SkillPhase, GameState, SkillContext, EngineResult, AtomLogEntry } from '../types';
import { registerPhase, executePlan } from '../phase';
import { checkCondition } from '../expr';

type LoopPhase = Extract<SkillPhase, { type: 'loop' }>;

export function register() {
  registerPhase<LoopPhase>({
    type: 'loop',
    execute(state: GameState, phase: LoopPhase, ctx: SkillContext, _plan: SkillPhase[], _index: number): EngineResult {
      let s = state;
      const logEntries: AtomLogEntry[] = [];
      let iterations = 0;

      while (checkCondition(phase.while, s, ctx)) {
        if (++iterations > 100) break;
        const result = executePlan(s, phase.body, ctx);
        s = result.state;
        logEntries.push(...result.logEntries);
        if (s.pending !== null) {
          return { state: s, logEntries };
        }
      }

      return { state: s, logEntries };
    },
  });
}
