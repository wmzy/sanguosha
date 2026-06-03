// engine/handlers/response/kill.ts — 杀响应窗口处理
//
// 出闪则抵消，不出则受 1 点伤害。武将"裸衣"技能可造成 2 点伤害。

import type { GameState, GameAction, EngineResult, Atom } from '../../types';
import { getPlayer } from '../../state';
import { makeServerEvent } from '../../event';
import { applyAtoms, applyDamage } from '../engine-utils';
import { isCardValidResponse } from '../../validate';
import { emitEvent } from '../../skill';

export function resolveKillResponse(
  state: GameState,
  action: GameAction,
  pending: import('../../types').PendingResponseWindow,
): EngineResult {
  if (action.type !== 'respond') {
    return { state, events: [], error: '杀响应窗口需要 respond 动作' };
  }

  const { attacker, defender } = pending.window;
  if (action.player !== defender) {
    return { state, events: [], error: '只有被杀者可以响应' };
  }

  // ── 出闪 → 闪避 ──
  if (action.cardId) {
    const responder = getPlayer(state, defender);
    if (!responder.hand.includes(action.cardId)) {
      return { state, events: [], error: '手牌中没有该卡牌' };
    }
    if (!isCardValidResponse(state, action.cardId, 'killResponse', defender)) {
      return { state, events: [], error: '只能用闪（或可当闪使用的牌）响应杀' };
    }

    const atoms: Atom[] = [
      {
        type: 'moveCard',
        cardId: action.cardId,
        from: { zone: 'hand', player: defender },
        to: { zone: 'discardPile' },
      },
      { type: 'popPending' },
    ];
    const result = applyAtoms(state, atoms);
    const emitResult = emitEvent(result.state, {
      type: 'killDodged',
      attacker: attacker ?? '',
      defender,
    });
    const dodgedEvent = makeServerEvent('killDodged', {
      attacker: attacker ?? '',
      defender,
    });
    return {
      state: emitResult.state,
      events: [...result.events, dodgedEvent, ...emitResult.events],
    };
  }

  // ── 不出闪 → 受到伤害 ──
  let damageAmount = 1;
  if (attacker) {
    const attackerState = getPlayer(state, attacker);
    if (attackerState.vars['裸衣/active'] === true) {
      damageAmount = 2;
    }
  }

  const { state: popState, events: popEvents } = applyAtoms(state, [{ type: 'popPending' }]);
  const damageResult = applyDamage(
    popState, defender, damageAmount,
    attacker ?? undefined, pending.window.sourceCard,
  );
  const emitResult = emitEvent(damageResult.state, {
    type: 'killHit',
    attacker: attacker ?? '',
    defender,
  });
  const hitEvent = makeServerEvent('killHit', {
    attacker: attacker ?? '',
    defender,
  });

  return {
    state: emitResult.state,
    events: [...popEvents, ...damageResult.events, hitEvent, ...emitResult.events],
  };
}
