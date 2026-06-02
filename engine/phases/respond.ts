import type { SkillPhase, GameState, SkillContext, EngineResult, PendingResponseWindow, ResponseWindowDef } from '../types';
import { TIMEOUT_DEFAULTS as timeouts } from '../types';
import { registerPhase } from '../phase';

type RespondPhase = Extract<SkillPhase, { type: 'respond' }>;

const timeoutByType: Record<ResponseWindowDef['type'], number> = {
  killResponse: timeouts.killResponse,
  aoeResponse: timeouts.aoeResponse,
  dyingResponse: timeouts.dyingResponse,
  trickResponse: timeouts.killResponse,
  duelResponse: timeouts.killResponse,
};

export function register() {
  registerPhase<RespondPhase>({
    type: 'respond',
    execute(state: GameState, phase: RespondPhase, _ctx: SkillContext, _plan: SkillPhase[], _index: number): EngineResult {
      const timeout = timeoutByType[phase.window.type];
      const deadline = Date.now() + timeout;
      const pending: PendingResponseWindow = {
        type: 'responseWindow',
        window: { ...phase.window, timeout, deadline },
        timeout,
        deadline,
        onTimeout: { type: 'respond', player: phase.window.defender },
      };
      return { state: { ...state, pending }, events: [] };
    },
  });
}
