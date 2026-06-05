import type { GameState, GameEvent, Atom, ServerEvent, PlayerEvent, PendingDyingWindow, EngineResult } from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import { applyAtoms } from '../atom';
import { emitEvent } from '../skill';
import { getPlayer, getAlivePlayerNames } from '../state';
import { makeServerEvent } from '../event';
import { createPendingId } from '../atoms/pending';

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


export function createDyingPending(state: GameState, dyingPlayer: string, _source?: string): PendingDyingWindow {
  const timeout = TIMEOUT_DEFAULTS.dyingResponse;
  const alivePlayers = getAlivePlayerNames(state);
  // 标准三国杀求桃规则：从当前回合玩家开始，按座位（行动）顺序依次询问，
  // 濒死者本人排在最后自救。
  const currentIdx = alivePlayers.indexOf(state.currentPlayer);
  const ordered = currentIdx >= 0
    ? [...alivePlayers.slice(currentIdx), ...alivePlayers.slice(0, currentIdx)]
    : alivePlayers;
  const others = ordered.filter(p => p !== dyingPlayer);
  const savers = [...others, dyingPlayer];
  return {
    id: createPendingId(),
    type: 'dyingWindow',
    dyingPlayer,
    currentSaverIndex: 0,
    savers,
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: 'respond', player: savers[0] },
  };
}
