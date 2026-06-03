import type { GameState, GameAction, EngineResult, Atom, PendingDyingWindow, ServerEvent } from '../types';
import { getPlayer } from '../state';
import { makeServerEvent } from '../event';
import { applyAtoms } from './engine-utils';
import { startAoeTargetWuxie } from './response-handlers';

export function resolveDying(
  state: GameState,
  action: GameAction,
  pending: PendingDyingWindow,
): EngineResult {
  if (action.type !== 'respond') {
    return { state, events: [], error: '濒死窗口需要 respond 动作' };
  }

  const currentSaver = pending.savers[pending.currentSaverIndex];
  if (action.player !== currentSaver) {
    return { state, events: [], error: '当前不是你的救助回合' };
  }

  // ── 出桃救人 ──
  if (action.cardId) {
    const saverState = getPlayer(state, currentSaver);
    if (!saverState.hand.includes(action.cardId)) {
      return { state, events: [], error: '手牌中没有该卡牌' };
    }
    const card = state.cardMap[action.cardId];
    if (card.name !== '桃') {
      return { state, events: [], error: '只能出桃救人' };
    }

    const healAtoms: Atom[] = [
      {
        type: 'moveCard',
        cardId: action.cardId,
        from: { zone: 'hand', player: currentSaver },
        to: { zone: 'discardPile' },
      },
      {
        type: 'heal',
        target: pending.dyingPlayer,
        amount: 1,
        source: currentSaver,
      },
    ];
    const healResult = applyAtoms(state, healAtoms);
    const healEvent = makeServerEvent('heal', {
      target: pending.dyingPlayer,
      amount: 1,
      source: currentSaver,
    });

    // 检查濒死者体力是否恢复到 > 0
    const dyingState = getPlayer(healResult.state, pending.dyingPlayer);
    if (dyingState.health > 0) {
      const popResult = applyAtoms(healResult.state, [{ type: 'popPending' }]);
      const resumed = resumeAoeChain(popResult.state, pending);
      return {
        state: resumed.state,
        events: [...healResult.events, healEvent, ...resumed.events],
      };
    }

    // 还没救活 → 尝试下一个救助者
    const nextIndex = pending.currentSaverIndex + 1;
    if (nextIndex >= pending.savers.length) {
      const deathAtoms: Atom[] = [
        { type: 'kill', player: pending.dyingPlayer },
        { type: 'popPending' },
      ];
      const deathResult = applyAtoms(healResult.state, deathAtoms);
      const deathEvent = makeServerEvent('death', { player: pending.dyingPlayer });
      const resumed = resumeAoeChain(deathResult.state, pending);
      return {
        state: resumed.state,
        events: [...healResult.events, healEvent, deathEvent, ...resumed.events],
      };
    }

    return {
      state: {
        ...healResult.state,
        pending: advanceToNextSaver(pending, nextIndex),
      },
      events: [...healResult.events, healEvent],
    };
  }

  // ── 不出桃 → 下一个救助者 ──
  const nextIndex = pending.currentSaverIndex + 1;

  if (nextIndex >= pending.savers.length) {
    // 无人救助 → 死亡
    const atoms: Atom[] = [
      { type: 'kill', player: pending.dyingPlayer },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    const deathEvent = makeServerEvent('death', { player: pending.dyingPlayer });
    const resumed = resumeAoeChain(result.state, pending);
    return { state: resumed.state, events: [...result.events, deathEvent, ...resumed.events] };
  }

  // 移到下一个救助者
  return {
    state: {
      ...state,
      pending: advanceToNextSaver(pending, nextIndex),
    },
    events: [],
  };
}

function advanceToNextSaver(pending: PendingDyingWindow, nextIndex: number): PendingDyingWindow {
  const nextSaver = pending.savers[nextIndex];
  return {
    ...pending,
    currentSaverIndex: nextIndex,
    deadline: Date.now() + pending.timeout,
    onTimeout: { type: 'respond', player: nextSaver },
  };
}

function resumeAoeChain(
  state: GameState,
  dyingPending: PendingDyingWindow,
): { state: GameState; events: ServerEvent[] } {
  const aoe = dyingPending.resumeAoe;
  if (!aoe || aoe.remainingTargets.length === 0) return { state, events: [] };

  const aliveTargets = aoe.remainingTargets.filter(
    t => state.players[t]?.info.alive,
  );
  if (aliveTargets.length === 0) return { state, events: [] };

  const result = startAoeTargetWuxie(state, {
    attacker: aoe.attacker,
    remainingTargets: aliveTargets,
    requiredCard: aoe.requiredCard,
    sourceCard: aoe.sourceCard,
  });

  return { state: result.state, events: result.events };
}
