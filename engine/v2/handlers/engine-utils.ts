import type { GameState, GameEvent, Atom, ServerEvent, PlayerEvent, PendingDyingWindow, EngineResult } from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import { broadcast } from '../atom';
import { emitEvent } from '../skill';
import { getPlayer, getAlivePlayerNames } from '../state';
import { makeServerEvent } from '../event';

export function mergePlayerEvents(...maps: (Map<string, PlayerEvent[]> | undefined)[]): Map<string, PlayerEvent[]> {
  const result = new Map<string, PlayerEvent[]>();
  for (const map of maps) {
    if (!map) continue;
    for (const [player, events] of map) {
      const existing = result.get(player) ?? [];
      result.set(player, [...existing, ...events]);
    }
  }
  return result;
}

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
  const { state: damagedState, events: damageEvents, playerEvents: damagePE } = applyAtoms(state, [damageAtom]);
  let allPE = damagePE;

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
  allPE = mergePlayerEvents(allPE, skillResult.playerEvents);

  if (s.pending !== null) {
    const targetState = getPlayer(s, target);
    if (targetState.health <= 0 && targetState.info.alive) {
      s = { ...s, deferredDyingCheck: { player: target, source } };
    }
    return { state: s, events: allEvents, playerEvents: allPE };
  }

  const targetState = getPlayer(s, target);
  if (targetState.health <= 0 && targetState.info.alive) {
    const dyingPending = createDyingPending(s, target, source);
    const { state: dyingState, events: dyingEvents, playerEvents: dyingPE } = applyAtoms(s, [
      { type: 'pushPending', action: dyingPending },
    ]);
    const dyingEvent = makeServerEvent('dying', {
      player: target,
      ...(source ? { source } : {}),
    });
    return {
      state: dyingState,
      events: [...allEvents, ...dyingEvents, dyingEvent],
      playerEvents: mergePlayerEvents(allPE, dyingPE),
    };
  }

  return { state: s, events: allEvents, playerEvents: allPE };
}

export function applyAtoms(state: GameState, atoms: Atom[]): { state: GameState; events: ServerEvent[]; playerEvents: Map<string, PlayerEvent[]> } {
  if (atoms.length === 0) return { state, events: [], playerEvents: new Map() };
  const startLen = state.serverLog.length;
  const { state: newState, playerEvents } = broadcast(state, atoms);
  return { state: newState, events: newState.serverLog.slice(startLen), playerEvents };
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
