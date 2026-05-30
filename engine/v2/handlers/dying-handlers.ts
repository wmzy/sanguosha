import type { GameState, GameAction, EngineResult, Atom, PendingDyingWindow } from '../types';
import { getPlayer } from '../state';
import { makeServerEvent } from '../event';
import { applyAtoms } from './engine-utils';

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

    const atoms: Atom[] = [
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
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    const healEvent = makeServerEvent('heal', {
      target: pending.dyingPlayer,
      amount: 1,
      source: currentSaver,
    });
    return { state: result.state, events: [...result.events, healEvent] };
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
    return { state: result.state, events: [...result.events, deathEvent] };
  }

  // 移到下一个救助者
  return {
    state: {
      ...state,
      pending: { ...pending, currentSaverIndex: nextIndex },
    },
    events: [],
  };
}
