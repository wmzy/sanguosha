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
  const alivePlayers = getAlivePlayerNames(state);
  // 濒死者优先自救，再按顺序询问其他玩家
  const savers = [
    dyingPlayer,
    ...alivePlayers.filter(p => p !== dyingPlayer),
  ];
  return {
    type: 'dyingWindow',
    dyingPlayer,
    currentSaverIndex: 0,
    savers,
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: 'respond', player: dyingPlayer },
  };
}
