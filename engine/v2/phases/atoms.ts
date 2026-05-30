import type { Atom, SkillPhase, PhaseDefinition, GameState, SkillContext, EngineResult } from '../types';
import { applyAtom } from '../atom';
import { registerPhase } from '../phase';

type AtomsPhase = Extract<SkillPhase, { type: 'atoms' }>;

registerPhase<AtomsPhase>({
  type: 'atoms',
  execute(state: GameState, phase: AtomsPhase, ctx: SkillContext, plan: SkillPhase[], index: number): EngineResult {
    let s = state;
    for (const atom of phase.ops) {
      s = applyAtom(s, atom as Atom);
    }
    return { state: s, events: [] };
  },
});
