// @ts-nocheck
// engine/handlers/response/kill.ts — 杀响应窗口处理
//
// 出闪则抵消，不出则受 1 点伤害。武将"裸衣"技能可造成 2 点伤害。

import type { GameState, GameAction, EngineResult, Atom, PendingResponseWindow } from '../../types';
import { getPlayer } from '../../state';
import { makeLogEntry } from '../../event';
import { applyAtoms } from '../../atom';
import { applyDamage } from '../engine-utils';
import { isCardValidResponse } from '../../validate';

export function resolveKillResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  if (action.type !== '打出') {
    return { state, logEntries: [], error: '杀响应窗口需要 respond 动作' };
  }

  const { attacker, defender } = pending.window;
  if (action.player !== defender) {
    return { state, logEntries: [], error: '只有被杀者可以响应' };
  }

  // ── 出闪 → 闪避 ──
  if (action.cardId) {
    const defenderState = getPlayer(state, defender);
    if (defenderState.tags.includes('cannotDodge')) {
      return { state, logEntries: [], error: '铁骑判定生效，不能使用闪' };
    }
    const responder = getPlayer(state, defender);
    if (!responder.hand.includes(action.cardId)) {
      return { state, logEntries: [], error: '手牌中没有该卡牌' };
    }
    if (!isCardValidResponse(state, action.cardId, 'killResponse', defender)) {
      return { state, logEntries: [], error: '只能用闪（或可当闪使用的牌）响应杀' };
    }

    const requiredFlashCount = pending.window.requiredFlashCount ?? 1;
    const moveResult = applyAtoms(state, [
      {
        type: '移动牌',
        cardId: action.cardId,
        from: { zone: '手牌', player: defender },
        to: { zone: '弃牌堆' },
      },
      { type: '弹出待定' },
    ]);

    if (requiredFlashCount > 1) {
      return {
        state,
        logEntries: [],
        error: '多闪响应（裸衣）暂未实现',
      };
    }

    const emitResult = applyAtoms(moveResult.state, [
      { type: '杀被闪避', attacker: attacker ?? '', defender },
    ]);
    const dodgedLogEntry = makeLogEntry({ type: '杀被闪避', attacker: attacker ?? '', defender } as unknown as Atom);
    return {
      state: emitResult.state,
      logEntries: [...moveResult.logEntries, dodgedLogEntry, ...emitResult.logEntries],
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

  const { state: popState, logEntries: popLogEntries } = applyAtoms(state, [{ type: '弹出待定' }]);
  const damageResult = applyDamage(
    popState, defender, damageAmount,
    attacker ?? undefined, pending.window.sourceCard,
  );
  const emitResult = applyAtoms(damageResult.state, [
    { type: '杀命中', attacker: attacker ?? '', defender },
  ]);
  const hitLogEntry = makeLogEntry({ type: '杀命中', attacker: attacker ?? '', defender } as unknown as Atom);

  return {
    state: emitResult.state,
    logEntries: [...popLogEntries, ...damageResult.logEntries, hitLogEntry, ...emitResult.logEntries],
  };
}
