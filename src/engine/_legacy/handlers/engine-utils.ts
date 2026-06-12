// @ts-nocheck
import type { GameState, Atom, PendingDyingWindow, EngineResult } from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import { applyAtoms } from '../atom';
import { getPlayer, getAlivePlayerNames } from '../state';
import { makeLogEntry } from '../event';
import { createPendingId } from '../atoms/pending';

export function applyDamage(
  state: GameState,
  target: string,
  amount: number,
  source?: string,
  cardId?: string,
): EngineResult {
  const damageAtom: Atom = {
    type: '造成伤害',
    target,
    amount,
    ...(source !== undefined ? { source } : {}),
    ...(cardId !== undefined ? { cardId } : {}),
  };
  const { state: s, logEntries: damageLogEntries } = applyAtoms(state, [damageAtom]);
  const allLogEntries = [...damageLogEntries];

  if (s.pending !== null) {
    const targetState = getPlayer(s, target);
    if (targetState.health <= 0 && targetState.info.alive) {
      s = { ...s, deferredDyingCheck: { player: target, source } };
    }
    return { state: s, logEntries: allLogEntries };
  }

  const targetState = getPlayer(s, target);
  if (targetState.health <= 0 && targetState.info.alive) {
    const dyingPending = createDyingPending(s, target, source);
    const { state: dyingState, logEntries: dyingLogEntries } = applyAtoms(s, [
      { type: '推入待定', action: dyingPending },
    ]);
    const dyingLogEntry = makeLogEntry({ type: '濒死', player: target, ...(source ? { source } : {}) } as unknown as Atom);
    return {
      state: dyingState,
      logEntries: [...allLogEntries, ...dyingLogEntries, dyingLogEntry],
    };
  }

  return { state: s, logEntries: allLogEntries };
}

export function createDyingPending(state: GameState, dyingPlayer: string, _source?: string): PendingDyingWindow {
  const timeout = TIMEOUT_DEFAULTS.dyingResponse;
  const alivePlayers = getAlivePlayerNames(state);
  // 标准三国杀求桃规则：从当前回合玩家开始，按座位（行动）顺序依次询问，
  // 濒死者本人排在最后自救。
  const currentIdx = alivePlayers.indexOf(state.currentPlayer);
  const ordered = currentIdx >= 0
    ? [...alivePlayers.slice(currentIdx), ...alivePlayers.slice(0, currentIdx)]
    : [...alivePlayers];
  const others = ordered.filter(p => p !== dyingPlayer);
  const savers = [...others, dyingPlayer];
  return {
    id: createPendingId(),
    type: '濒死窗口',
    dyingPlayer,
    currentSaverIndex: 0,
    savers,
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: '打出', player: savers[0] },
  };
}
