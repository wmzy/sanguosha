// engine/handlers/response/duel.ts — 决斗响应窗口
//
// 决斗：双方轮流交出杀，先不出杀者受 1 点伤害。

import type { GameState, GameAction, EngineResult, PendingResponseWindow } from '../../types';
import { getPlayer } from '../../state';
import { applyAtoms } from '../../atom';
import { applyDamage } from '../engine-utils';
import { isCardValidResponse } from '../../validate';

export function resolveDuelResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  const { defender, attacker, sourceCard } = pending.window;
  if (!attacker || !sourceCard) {
    return { state, events: [], error: '决斗响应窗口缺少必要参数' };
  }

  const cardId = action.type === '打出' ? action.cardId : undefined;

  if (cardId) {
    // 当前防守方出了杀 → 换对方继续出杀
    if (!isCardValidResponse(state, cardId, 'duelResponse', defender)) {
      return { state, events: [], error: '只能用杀（或可当杀使用的牌）响应决斗' };
    }
    const responder = getPlayer(state, defender);
    if (!responder.hand.includes(cardId)) {
      return { state, events: [], error: '手牌中没有该卡牌' };
    }

    // 弃杀，弹掉当前窗口
    const moveResult = applyAtoms(state, [
      {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: defender },
        to: { zone: '弃牌堆' },
      },
      { type: '弹出待定' },
    ]);

    // 轮到对方出杀：交换 attacker/defender
    const nextDefender = attacker;
    const nextAttacker = defender;
    const validKills = getPlayer(moveResult.state, nextDefender).hand.filter(
      id => moveResult.state.cardMap[id]?.name === '杀',
    );
    const duelTimeout = 15000;
    const nextDuel: PendingResponseWindow = {
      id: 'duel-next',
      type: '响应窗口',
      window: {
        type: 'duelResponse',
        attacker: nextAttacker,
        defender: nextDefender,
        validCards: validKills,
        sourceCard,
        timeout: duelTimeout,
        deadline: Date.now() + duelTimeout,
      },
      timeout: duelTimeout,
      deadline: Date.now() + duelTimeout,
      onTimeout: { type: '打出', player: nextDefender },
    };
    const pushResult = applyAtoms(moveResult.state, [
      { type: '推入待定', action: nextDuel },
    ]);
    return {
      state: pushResult.state,
      events: [...moveResult.events, ...pushResult.events],
    };
  }

  // 没出杀 → 当前防守方受 1 点伤害
  const { state: popState, events: popEvents } = applyAtoms(state, [{ type: '弹出待定' }]);
  const damageResult = applyDamage(popState, defender, 1, attacker, sourceCard);

  return {
    state: damageResult.state,
    events: [...popEvents, ...damageResult.events],
  };
}
