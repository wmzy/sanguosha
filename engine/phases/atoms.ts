import type { SkillPhase, GameState, SkillContext, EngineResult, ServerEvent, Atom } from '../types';
import { applyAtom, atomToEvents, getAtomDef } from '../atom';
import { registerPhase } from '../phase';
import { resolve } from '../expr';
import { isExpr } from '../types';
import { ATOM_GAME_EVENTS } from '../atom-game-events';
import { emitEvent } from '../skill';

type AtomsPhase = Extract<SkillPhase, { type: 'atoms' }>;

function resolveExprFields<A>(obj: A, state: GameState, ctx: SkillContext): A {
  if (obj === null || obj === undefined) return obj;
  if (isExpr(obj)) return resolve(obj as Parameters<typeof resolve>[0], state, ctx) as A;
  if (Array.isArray(obj)) return obj.map(item => resolveExprFields(item, state, ctx)) as A;
  if (typeof obj === 'object' && obj.constructor === Object) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      result[key] = resolveExprFields((obj as Record<string, unknown>)[key], state, ctx);
    }
    return result as A;
  }
  return obj;
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
          const setCtx = atom;
          ctx.localVars[setCtx.key] = setCtx.value;
        }
        const [serverEvent] = atomToEvents(s, atom);
        events.push(serverEvent);
        s = applyAtom(s, atom);

        const def = getAtomDef(atom.type);
        if (def.getResult) {
          const result = def.getResult(s, atom);
          Object.assign(ctx.localVars, result);
        }

        const eventGen = ATOM_GAME_EVENTS[atom.type];
        if (eventGen) {
          const gameEvents = eventGen(s, atom);
          for (const ge of gameEvents) {
            const emitResult = emitEvent(s, ge);
            s = emitResult.state;
            events.push(...emitResult.events);
            if (s.pending !== null) {
              return { state: s, events };
            }
          }
        }
      }
      return { state: s, events };
    },
  });
}
