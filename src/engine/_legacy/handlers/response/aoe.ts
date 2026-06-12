// @ts-nocheck
// engine/handlers/response/aoe.ts — AOE 锦囊响应窗口
//
// 处理南蛮入侵、万箭齐发：每个目标依次出对应类型的牌响应。

import type { GameState, GameAction, EngineResult, Atom, PendingResponseWindow } from '../../types';
import { getPlayer, getAlivePlayerNames } from '../../state';
import { applyAtoms } from '../../atom';
import { applyDamage } from '../engine-utils';
import { createPendingId } from '../../atoms/pending';
import { TIMEOUT_DEFAULTS } from '../../types';
import { createConcurrentTrickResponse } from './trick';

export function resolveAoeResponse(
  state: GameState,
  action: GameAction,
  pending: PendingResponseWindow,
): EngineResult {
  if (action.type !== '打出') {
    return { state, logEntries: [], error: 'AOE 响应窗口需要 respond 动作' };
  }

  const { defender, attacker, remainingTargets, requiredCard, sourceCard } = pending.window;

  // 处理当前玩家的响应
  if (action.cardId) {
    const atoms: Atom[] = [
      { type: '移动牌', cardId: action.cardId, from: { zone: '手牌', player: defender }, to: { zone: '弃牌堆' } },
      { type: '弹出待定' },
    ];
    const result = applyAtoms(state, atoms);
    const s = result.state;
    const logEntries = result.logEntries;

    // 还有剩余玩家需要响应 → 创建下一个 aoeResponse
    if (remainingTargets && remainingTargets.length > 0 && attacker && requiredCard && sourceCard) {
      return startAoeTargetWuxie(s, { attacker, remainingTargets, requiredCard, sourceCard });
    }
    return { state: s, logEntries };
  }

  const { state: popState, logEntries: popLogEntries } = applyAtoms(state, [{ type: '弹出待定' }]);
  const damageResult = applyDamage(
    popState, defender, 1,
    attacker ?? undefined, sourceCard,
  );
  const allLogEntries = [...popLogEntries, ...damageResult.logEntries];

  const hasRemainingTargets = !!(remainingTargets && remainingTargets.length > 0 && attacker && requiredCard && sourceCard);

  if (damageResult.state.pending?.type === '濒死窗口' && hasRemainingTargets) {
    const resumeAoe = { attacker, remainingTargets, requiredCard, sourceCard };
    return {
      state: { ...damageResult.state, pending: { ...damageResult.state.pending, resumeAoe } },
      logEntries: allLogEntries,
    };
  }

  if (damageResult.state.pending !== null) {
    return { state: damageResult.state, logEntries: allLogEntries };
  }

  if (hasRemainingTargets) {
    return startAoeTargetWuxie(damageResult.state, {
      attacker,
      remainingTargets,
      requiredCard,
      sourceCard,
    });
  }

  return { state: damageResult.state, logEntries: allLogEntries };
}

/** 把 AOE 链恢复成针对下一个目标的响应窗口。 */
export function executeAoeResume(
  state: GameState,
  aoeResume: { attacker: string; remainingTargets: string[]; requiredCard: string; sourceCard: string },
): EngineResult {
  const { attacker, remainingTargets, requiredCard, sourceCard } = aoeResume;
  if (remainingTargets.length === 0) return { state, logEntries: [] };

  const firstTarget = remainingTargets[0];
  const nextRemaining = remainingTargets.slice(1);
  const targetPlayer = getPlayer(state, firstTarget);
  const validCards = targetPlayer.hand.filter(
    id => state.cardMap[id]?.name === requiredCard,
  );
  const timeout = TIMEOUT_DEFAULTS.aoeResponse;

  const nextPending: PendingResponseWindow = {
    id: createPendingId(),
    type: '响应窗口',
    window: {
      type: 'aoeResponse',
      attacker,
      defender: firstTarget,
      validCards,
      sourceCard,
      remainingTargets: nextRemaining,
      requiredCard,
      timeout,
      deadline: Date.now() + timeout,
    },
    timeout,
    deadline: Date.now() + timeout,
    onTimeout: { type: '打出', player: firstTarget },
  };

  return applyAtoms(state, [{ type: '推入待定', action: nextPending }]);
}

/**
 * 为 AOE 的下一个目标开启无懈可击询问窗口。
 * remainingTargets[0] 是当前要处理的目标。
 */
export function startAoeTargetWuxie(
  state: GameState,
  params: {
    attacker: string;
    remainingTargets: string[];
    requiredCard: string;
    sourceCard: string;
  },
): EngineResult {
  const { attacker, remainingTargets, requiredCard, sourceCard } = params;

  // 过滤存活的目标
  const aliveTargets = remainingTargets.filter(t => getPlayer(state, t).info.alive);
  if (aliveTargets.length === 0) return { state, logEntries: [] };

  // 所有存活玩家都可以出无懈可击（包括出牌者）
  const allAlive = getAlivePlayerNames(state);

  if (allAlive.length === 0) {
    // 无人可出无懈，直接创建 aoeResponse
    return executeAoeResume(state, { attacker, remainingTargets: aliveTargets, requiredCard, sourceCard });
  }

  const currentTarget = aliveTargets[0];

  // 创建无懈可击窗口，trickTarget 设为当前 AOE 目标
  const trickResponse = createConcurrentTrickResponse(state, {
    sourceCard,
    attacker,
    trickTarget: currentTarget,
    responders: allAlive,
    depth: 0,
    aoeResume: { attacker, remainingTargets: aliveTargets, requiredCard, sourceCard },
  });

  return applyAtoms(state, [{ type: '推入待定', action: trickResponse }]);
}
