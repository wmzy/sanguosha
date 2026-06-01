import type { GameState, GameEvent, Atom, ServerEvent, PendingDyingWindow, EngineResult } from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import { broadcast } from '../atom';
import { emitEvent } from '../skill';
import { getPlayer, getAlivePlayerNames } from '../state';
import { makeServerEvent } from '../event';

export function applyDamage(
  state: GameState,
  target: string,
  amount: number,
  source?: string,
  cardId?: string,
): EngineResult {
  const damageAtom: Atom = {
    type: 'damage',
    target,
    amount,
    ...(source !== undefined ? { source } : {}),
    ...(cardId !== undefined ? { cardId } : {}),
  };
  const { state: damagedState, events: damageEvents } = applyAtoms(state, [damageAtom]);

  const gameEvent: GameEvent = {
    type: 'damageReceived',
    target,
    source: source ?? '',
    amount,
    ...(cardId !== undefined ? { cardId } : {}),
  };
  const skillResult = emitEvent(damagedState, gameEvent);
  let s = skillResult.state;
  const allEvents = [...damageEvents, ...skillResult.events];

  if (s.pending !== null) {
    const targetState = getPlayer(s, target);
    if (targetState.health <= 0 && targetState.info.alive) {
      s = { ...s, deferredDyingCheck: { player: target, source } };
    }
    return { state: s, events: allEvents };
  }

  const targetState = getPlayer(s, target);
  if (targetState.health <= 0 && targetState.info.alive) {
    const dyingPending = createDyingPending(s, target, source);
    const { state: dyingState, events: dyingEvents } = applyAtoms(s, [
      { type: 'pushPending', action: dyingPending },
    ]);
    const dyingEvent = makeServerEvent('dying', {
      player: target,
      ...(source ? { source } : {}),
    });
    return {
      state: dyingState,
      events: [...allEvents, ...dyingEvents, dyingEvent],
    };
  }

  return { state: s, events: allEvents };
}

export function applyAtoms(state: GameState, atoms: Atom[]): { state: GameState; events: ServerEvent[] } {
  if (atoms.length === 0) return { state, events: [] };
  const startLen = state.serverLog.length;
  const { state: newState } = broadcast(state, atoms);
  return { state: newState, events: newState.serverLog.slice(startLen) };
}

export function createDyingPending(state: GameState, dyingPlayer: string, _source?: string): PendingDyingWindow {
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
