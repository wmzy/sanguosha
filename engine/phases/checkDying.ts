import type { SkillPhase, GameState, SkillContext, EngineResult, PendingDyingWindow } from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import { registerPhase } from '../phase';
import { resolve } from '../expr';
import { getPlayer, getAlivePlayerNames } from '../state';
import { makeServerEvent } from '../event';
import { createPendingId } from '../atoms/pending';

type CheckDyingPhase = Extract<SkillPhase, { type: 'checkDying' }>;

export function register() {
  registerPhase<CheckDyingPhase>({
    type: 'checkDying',
    execute(state: GameState, phase: CheckDyingPhase, ctx: SkillContext, _plan: SkillPhase[], _index: number): EngineResult {
      const playerName = resolve<string>(phase.player, state, ctx);
      const player = getPlayer(state, playerName);

      if (player.health <= 0 && player.info.alive) {
        const timeout = TIMEOUT_DEFAULTS.dyingResponse;
        const pending: PendingDyingWindow = {
          id: createPendingId(),
          type: '濒死窗口',
          dyingPlayer: playerName,
          currentSaverIndex: 0,
          savers: getAlivePlayerNames(state),
          timeout,
          deadline: Date.now() + timeout,
          onTimeout: { type: '打出', player: playerName },
        };
        const dyingEvent = makeServerEvent('濒死', { player: playerName });
        return { state: { ...state, pending }, events: [dyingEvent] };
      }

      return { state, events: [] };
    },
  });
}
