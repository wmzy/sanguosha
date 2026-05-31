import type { SkillPhase, GameState, SkillContext, EngineResult, ServerEvent, Atom, Json } from '../types';
import { applyAtom, atomToEvents } from '../atom';
import { registerPhase } from '../phase';
import { resolve } from '../expr';
import { isExpr } from '../types';

type AtomsPhase = Extract<SkillPhase, { type: 'atoms' }>;

function resolveExprFields<A extends Atom>(atom: A, state: GameState, ctx: SkillContext): A {
  const result = { ...atom } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (key !== 'type') {
      const value = result[key];
      if (isExpr(value)) {
        result[key] = resolve(value as Parameters<typeof resolve>[0], state, ctx);
      }
    }
  }
  return result as A;
}

export function register() {
  registerPhase<AtomsPhase>({
    type: 'atoms',
    execute(state: GameState, phase: AtomsPhase, ctx: SkillContext, _plan: SkillPhase[], _index: number): EngineResult {
      let s = state;
      const events: ServerEvent[] = [];
      for (const rawAtom of phase.ops) {
        const atom = resolveExprFields(rawAtom, s, ctx);
        if (atom.type === 'setCtxVar') {
          const setCtx = atom as Atom & { type: 'setCtxVar'; key: string; value: Json };
          ctx.localVars[setCtx.key] = setCtx.value;
        }
        const [serverEvent] = atomToEvents(s, atom);
        events.push(serverEvent);
        s = applyAtom(s, atom);
      }
      return { state: s, events };
    },
  });
}
