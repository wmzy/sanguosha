// @ts-nocheck
import type { GameState, GameAction, EngineResult, Atom, PendingDyingWindow, AtomLogEntry } from '../types';
import { getPlayer } from '../state';
import { makeLogEntry } from '../event';
import { applyAtoms } from '../atom';
import { startAoeTargetWuxie } from './response-handlers';
import { isCardValidResponse } from '../validate';

export function resolveDying(
  state: GameState,
  action: GameAction,
  pending: PendingDyingWindow,
): EngineResult {
  if (action.type !== '打出') {
    return { state, logEntries: [], error: '濒死窗口需要 respond 动作' };
  }

  const currentSaver = pending.savers[pending.currentSaverIndex];
  if (action.player !== currentSaver) {
    return { state, logEntries: [], error: '当前不是你的救助回合' };
  }

  // ── 出桃救人 ──
  if (action.cardId) {
    const saverState = getPlayer(state, currentSaver);
    if (!saverState.hand.includes(action.cardId)) {
      return { state, logEntries: [], error: '手牌中没有该卡牌' };
    }
    if (!isCardValidResponse(state, action.cardId, 'dyingResponse', currentSaver)) {
      return { state, logEntries: [], error: '只能用桃（或急救红色手牌）救人' };
    }

    const healAtoms: Atom[] = [
      {
        type: '移动牌',
        cardId: action.cardId,
        from: { zone: '手牌', player: currentSaver },
        to: { zone: '弃牌堆' },
      },
      {
        type: '回复体力',
        target: pending.dyingPlayer,
        amount: 1,
        source: currentSaver,
      },
    ];
    const healResult = applyAtoms(state, healAtoms);
    const healLogEntry = makeLogEntry({ type: '回复体力', target: pending.dyingPlayer, amount: 1, source: currentSaver } as unknown as Atom);

    // 检查濒死者体力是否恢复到 > 0
    const dyingState = getPlayer(healResult.state, pending.dyingPlayer);
    if (dyingState.health > 0) {
      const popResult = applyAtoms(healResult.state, [{ type: '弹出待定' }]);
      const resumed = resumeAoeChain(popResult.state, pending);
      return {
        state: resumed.state,
        logEntries: [...healResult.logEntries, healLogEntry, ...resumed.logEntries],
      };
    }

    // 还没救活 → 尝试下一个救助者
    const nextIndex = pending.currentSaverIndex + 1;
    if (nextIndex >= pending.savers.length) {
      const deathAtoms: Atom[] = [
        { type: '击杀', player: pending.dyingPlayer },
        { type: '弹出待定' },
      ];
      const deathResult = applyAtoms(healResult.state, deathAtoms);
      const deathLogEntry = makeLogEntry({ type: '死亡', player: pending.dyingPlayer } as unknown as Atom);
      const resumed = resumeAoeChain(deathResult.state, pending);
      return {
        state: resumed.state,
        logEntries: [...healResult.logEntries, healLogEntry, deathLogEntry, ...resumed.logEntries],
      };
    }

    return {
      state: {
        ...healResult.state,
        pending: advanceToNextSaver(pending, nextIndex),
      },
      logEntries: [...healResult.logEntries, healLogEntry],
    };
  }

  // ── 不出桃 → 下一个救助者 ──
  const nextIndex = pending.currentSaverIndex + 1;

  if (nextIndex >= pending.savers.length) {
    // 无人救助 → 死亡
    const atoms: Atom[] = [
      { type: '击杀', player: pending.dyingPlayer },
      { type: '弹出待定' },
    ];
    const result = applyAtoms(state, atoms);
    const deathLogEntry = makeLogEntry({ type: '死亡', player: pending.dyingPlayer } as unknown as Atom);
    const resumed = resumeAoeChain(result.state, pending);
    return { state: resumed.state, logEntries: [...result.logEntries, deathLogEntry, ...resumed.logEntries] };
  }

  // 移到下一个救助者
  return {
    state: {
      ...state,
      pending: advanceToNextSaver(pending, nextIndex),
    },
    logEntries: [],
  };
}

function advanceToNextSaver(pending: PendingDyingWindow, nextIndex: number): PendingDyingWindow {
  const nextSaver = pending.savers[nextIndex];
  return {
    ...pending,
    currentSaverIndex: nextIndex,
    deadline: Date.now() + pending.timeout,
    onTimeout: { type: '打出', player: nextSaver },
  };
}

function resumeAoeChain(
  state: GameState,
  dyingPending: PendingDyingWindow,
): { state: GameState; logEntries: AtomLogEntry[] } {
  const aoe = dyingPending.resumeAoe;
  if (!aoe || aoe.remainingTargets.length === 0) return { state, logEntries: [] };

  const aliveTargets = aoe.remainingTargets.filter(
    t => state.players[t]?.info.alive,
  );
  if (aliveTargets.length === 0) return { state, logEntries: [] };

  const result = startAoeTargetWuxie(state, {
    attacker: aoe.attacker,
    remainingTargets: aliveTargets,
    requiredCard: aoe.requiredCard,
    sourceCard: aoe.sourceCard,
  });

  return { state: result.state, logEntries: result.logEntries };
}
