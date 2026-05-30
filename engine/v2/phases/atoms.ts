import type { SkillPhase, GameState, SkillContext, EngineResult, ServerEvent } from '../types';
import { applyAtom, atomToEvents } from '../atom';
import { registerPhase } from '../phase';

type AtomsPhase = Extract<SkillPhase, { type: 'atoms' }>;

export function register() {
  registerPhase<AtomsPhase>({
    type: 'atoms',
    execute(state: GameState, phase: AtomsPhase, ctx: SkillContext, _plan: SkillPhase[], _index: number): EngineResult {
      let s = state;
      const events: ServerEvent[] = [];
      for (const atom of phase.ops) {
        if (atom.type === 'setCtxVar') {
          ctx.localVars[atom.key] = atom.value;
        }
        const [serverEvent] = atomToEvents(s, atom);
        events.push(serverEvent);
        s = applyAtom(s, atom);
      }
      return { state: s, events };
    },
  });
}
