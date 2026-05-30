import type { SkillPhase, PhaseDefinition, GameState, SkillContext, EngineResult, PendingDyingWindow } from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import { registerPhase } from '../phase';
import { resolve } from '../expr';
import { getPlayer, getAlivePlayerNames } from '../state';

type CheckDyingPhase = Extract<SkillPhase, { type: 'checkDying' }>;

registerPhase<CheckDyingPhase>({
  type: 'checkDying',
  execute(state: GameState, phase: CheckDyingPhase, ctx: SkillContext, plan: SkillPhase[], index: number): EngineResult {
    const playerName = resolve<string>(phase.player, state, ctx);
    const player = getPlayer(state, playerName);

    if (player.health <= 0 && player.info.alive) {
      const timeout = TIMEOUT_DEFAULTS.dyingResponse;
      const pending: PendingDyingWindow = {
        type: 'dyingWindow',
        dyingPlayer: playerName,
        currentSaverIndex: 0,
        savers: getAlivePlayerNames(state),
        timeout,
        deadline: Date.now() + timeout,
        onTimeout: { type: 'respond', player: playerName },
      };
      return { state: { ...state, pending }, events: [] };
    }

    return { state, events: [] };
  },
});
