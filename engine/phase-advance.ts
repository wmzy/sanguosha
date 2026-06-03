/**
 * engine/phase-advance.ts — 回合阶段自动推进
 *
 * 自动执行"准备→判定→摸牌→出牌"的阶段性推进。
 * 每个阶段 emit phaseBegin 事件（触发监听该阶段的技能），
 * 并在特定阶段执行自动行为（摸牌阶段抽 2 张牌）。
 *
 * 只有出牌阶段和弃牌阶段需要玩家交互，其余阶段自动推进。
 */

import type { GameState, ServerEvent, EngineResult, GameEvent, Atom, PendingPlayPhase } from './types';
import { TIMEOUT_DEFAULTS } from './types';
import type { TurnPhase } from '../shared/types';
import { emitEvent, clearTurnVars } from './skill';
import { applyAtoms } from './handlers/engine-utils';
import { createPendingId } from './atoms/pending';
import { getPlayer, getAlivePlayerNames } from './state';
import { createConcurrentTrickResponse } from './handlers/response-handlers';
import { makeServerEvent } from './event';

/**
 * 处理判定阶段的延迟锦囊（乐不思蜀、兵粮寸断）
 *
 * 三国杀规则：
 * - 乐不思蜀：判定牌不是红桃♥时生效（跳过出牌阶段）
 * - 兵粮寸断：判定牌不是梅花♣时生效（跳过摸牌阶段）
 */
function processJudgmentPhase(state: GameState, player: string): EngineResult {
  const playerState = getPlayer(state, player);
  const { pendingTricks } = playerState;
  if (pendingTricks.length === 0) {
    return { state, events: [] };
  }

  const aliveOthers = getAlivePlayerNames(state).filter(p => p !== player);
  if (aliveOthers.length === 0) {
    return batchProcessJudgments(state, player, pendingTricks);
  }

  const lastIndex = pendingTricks.length - 1;
  const trick = pendingTricks[lastIndex];
  const pending = createConcurrentTrickResponse(state, {
    sourceCard: trick.card.id,
    attacker: trick.source,
    trickTarget: player,
    responders: aliveOthers,
    depth: 0,
    judgmentContext: { player, trickIndex: lastIndex },
  });
  const result = applyAtoms(state, [{ type: 'pushPending', action: pending }]);
  return { state: result.state, events: result.events };
}

function batchProcessJudgments(
  state: GameState,
  player: string,
  tricks: import('../shared/types').PendingTrick[],
): EngineResult {
  const atoms: Atom[] = [];
  const tags: string[] = [];

  for (let i = tricks.length - 1; i >= 0; i--) {
    const trick = tricks[i];
    atoms.push({ type: 'judge', player, varKey: `judgeResult_${trick.name}_${i}` });
    atoms.push({ type: 'removePendingTrick', player, index: i });
  }

  const actionResult = applyAtoms(state, atoms);
  const s = actionResult.state;

  for (let i = tricks.length - 1; i >= 0; i--) {
    const trick = tricks[i];
    const discardPile = s.zones.discardPile;
    const judgedCardId = discardPile[discardPile.length - 1 - i];
    const suit = judgedCardId ? s.cardMap[judgedCardId]?.suit : '♣';

    if (trick.name === '乐不思蜀' && suit !== '♥') {
      tags.push('skipPlay');
    } else if (trick.name === '兵粮寸断' && suit !== '♣') {
      tags.push('skipDraw');
    }
  }

  if (tags.length > 0) {
    const tagAtoms = tags.map(tag => ({ type: 'addTag' as const, player, tag }));
    const tagResult = applyAtoms(s, tagAtoms);
    return { state: tagResult.state, events: [...actionResult.events, ...tagResult.events] };
  }

  return { state: s, events: actionResult.events };
}

export function isAutoPhase(phase: string): boolean {
  return phase === '准备' || phase === '判定' || phase === '摸牌';
}

function processPhaseStep(state: GameState): EngineResult {
  const phase = state.phase;
  const player = state.currentPlayer;
  const allEvents: ServerEvent[] = [];

  const beginFlag = `phaseBegin/${phase}`;
  let s = state;
  if (!s.turn.phaseFlags.includes(beginFlag)) {
    const phaseBeginEvent: GameEvent = { type: 'phaseBegin', phase, player };
    const emitResult = emitEvent(s, phaseBeginEvent);
    allEvents.push(...emitResult.events);
    s = { ...emitResult.state, turn: { ...emitResult.state.turn, phaseFlags: [...emitResult.state.turn.phaseFlags, beginFlag] } };

    if (s.pending !== null) {
      return { state: s, events: allEvents };
    }
  }

  if (phase === '判定') {
    const judgmentResult = processJudgmentPhase(s, player);
    s = judgmentResult.state;
    allEvents.push(...judgmentResult.events);
    if (s.pending !== null) {
      return { state: s, events: allEvents };
    }
  } else {
    const phaseActions = getPhaseActions(s, phase, player);
    if (phaseActions.length > 0) {
      const actionResult = applyAtoms(s, phaseActions);
      s = actionResult.state;
      allEvents.push(...actionResult.events);
    }
    if (s.pending !== null) {
      return { state: s, events: allEvents };
    }
  }

  const nextPhase = getNextPhase(phase);
  if (!nextPhase || nextPhase === phase) {
    return { state: s, events: allEvents };
  }

  // 发射 phaseEnd 事件（触发监听当前阶段结束的技能，如貂蝉闭月）
  const phaseEndEvent: GameEvent = { type: 'phaseEnd', phase, player };
  const phaseEndResult = emitEvent(s, phaseEndEvent);
  allEvents.push(...phaseEndResult.events);
  if (phaseEndResult.state.pending !== null) {
    return { state: phaseEndResult.state, events: allEvents };
  }
  s = phaseEndResult.state;

  const { state: phaseState, events: phaseEvents } = applyAtoms(s, [
    { type: 'setPhase', phase: nextPhase },
  ]);
  allEvents.push(...phaseEvents);

  return { state: phaseState, events: allEvents };
}

function getPhaseActions(state: GameState, phase: TurnPhase, player: string): import('./types').Atom[] {
  const playerState = getPlayer(state, player);
  switch (phase) {
    case '准备':
      return [];
    case '摸牌':
      if (playerState.tags.includes('skipDraw')) {
        return [{ type: 'removeTag' as const, player, tag: 'skipDraw' }];
      }
      const drawCount = playerState.vars['裸衣/active'] === true ? 1 : 2;
      return [{ type: 'draw' as const, player, count: drawCount }];
    default:
      return [];
  }
}

function getNextPhase(phase: TurnPhase): TurnPhase | null {
  const sequence: TurnPhase[] = ['准备', '判定', '摸牌', '出牌'];
  const idx = sequence.indexOf(phase);
  if (idx === -1 || idx >= sequence.length - 1) return null;
  return sequence[idx + 1];
}

function isPreparationPhase(phase: string): boolean {
  return phase === '准备';
}

function shouldSkipPhase(state: GameState, phase: string, player: string): boolean {
  const playerState = getPlayer(state, player);
  if (phase === '出牌' && playerState.tags.includes('skipPlay')) {
    return true;
  }
  return false;
}

export function advanceToInteractivePhase(state: GameState): EngineResult {
  let s = state;
  const allEvents: ServerEvent[] = [];

  // turnStart 每回合只发射一次，由 nextPlayer atom 重置 phaseFlags
  if (!s.turn.phaseFlags.includes('turnStarted')) {
    const turnStartGameEvent: GameEvent = { type: 'turnStart', player: s.currentPlayer };
    const turnStartResult = emitEvent(s, turnStartGameEvent);
    s = {
      ...turnStartResult.state,
      turn: {
        ...turnStartResult.state.turn,
        phaseFlags: [...turnStartResult.state.turn.phaseFlags, 'turnStarted'],
      },
    };
    allEvents.push(...turnStartResult.events);
    const turnStartLogEvent = makeServerEvent('turnStart', { player: s.currentPlayer });
    allEvents.push(turnStartLogEvent);
    if (s.pending !== null) {
      return { state: s, events: allEvents };
    }
  }

  while (isAutoPhase(s.phase)) {
    if (isPreparationPhase(s.phase)) {
      s = clearTurnVars(s);
    }
    const result = processPhaseStep(s);
    s = result.state;
    allEvents.push(...result.events);

    if (result.error) return { state: s, events: allEvents, error: result.error };
    if (s.pending !== null) return { state: s, events: allEvents };
  }

  // 出牌阶段被乐不思蜀跳过 → 直接设置到弃牌阶段
  if (s.pending === null && s.phase === '出牌' && shouldSkipPhase(s, s.phase, s.currentPlayer)) {
    const skipAtoms: Atom[] = [
      { type: 'removeTag' as const, player: s.currentPlayer, tag: 'skipPlay' },
      { type: 'setPhase' as const, phase: '弃牌' as TurnPhase },
    ];
    const skipResult = applyAtoms(s, skipAtoms);
    s = skipResult.state;
    allEvents.push(...skipResult.events);
  }

  // 出牌阶段 → 创建 playPhase pending（带 deadline）
  if (s.pending === null && s.phase === '出牌' && !shouldSkipPhase(s, s.phase, s.currentPlayer)) {
    const timeout = TIMEOUT_DEFAULTS.playPhase;
    const playPending: PendingPlayPhase = {
      id: createPendingId(),
      type: 'playPhase',
      player: s.currentPlayer,
      timeout,
      deadline: Date.now() + timeout,
      onTimeout: { type: 'endTurn', player: s.currentPlayer },
    };
    const pushResult = applyAtoms(s, [{ type: 'pushPending', action: playPending }]);
    s = pushResult.state;
    allEvents.push(...pushResult.events);
  }

  return { state: s, events: allEvents };
}
