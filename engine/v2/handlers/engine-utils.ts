import type { GameState, Atom, ServerEvent, PendingDyingWindow } from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import { broadcast } from '../atom';
import { getAlivePlayerNames } from '../state';

export function applyAtoms(state: GameState, atoms: Atom[]): { state: GameState; events: ServerEvent[] } {
  if (atoms.length === 0) return { state, events: [] };
  const startLen = state.serverLog.length;
  const { state: newState } = broadcast(state, atoms);
  return { state: newState, events: newState.serverLog.slice(startLen) };
}

export function createDyingPending(state: GameState, dyingPlayer: string, source?: string): PendingDyingWindow {
  const timeout = TIMEOUT_DEFAULTS.dyingResponse;
  return {
    type: 'dyingWindow',
    dyingPlayer,
    currentSaverIndex: 0,
    savers: getAlivePlayerNames(state),
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: 'respond', player: dyingPlayer },
  };
}
