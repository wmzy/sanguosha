/**
 * engine/phase-advance.ts — 回合阶段自动推进
 *
 * 自动执行"准备→判定→摸牌→出牌"的阶段性推进。
 * 每个阶段 emit phaseBegin 事件（触发监听该阶段的技能），
 * 并在特定阶段执行自动行为（摸牌阶段抽 2 张牌）。
 *
 * 只有出牌阶段和弃牌阶段需要玩家交互，其余阶段自动推进。
 *
 * Phase 13（setPhase 拆分）：processPhaseStep 改为显式 phaseBegin + 阶段内
 * actions + phaseEnd + setPhase 序列，避免"xx阶段开始"和"yy阶段结束"乱序
 * （克己等强制跳阶段技能）。
 *
 * 注意：phaseBegin/phaseEnd atom 走 applyAtoms 写 serverLog 后，**必须**显式
 * 调 emitEvent 派 GameEvent 给技能钩子（38+ 技能监听 phaseBegin）。Phase 10b
 * 完成统一钩子后这里会简化。
 */

import type { GameState, ServerEvent, EngineResult, GameEvent, Atom, PendingPlayPhase, PendingTrick } from './types';
import { TIMEOUT_DEFAULTS } from './types';
import type { TurnPhase } from '../shared/types';
import { emitEvent, clearTurnVars } from './skill';
import { applyAtoms } from './atom';
import { createPendingId } from './atoms/pending';
import { getPlayer, getAlivePlayerNames } from './state';
import { createConcurrentTrickResponse } from './handlers/response-handlers';
import { makeServerEvent } from './event';

/**
 * 处理判定阶段的延迟锦囊（乐不思蜀、兵粮寸断）
 */
function processJudgmentPhase(state: GameState, player: string): EngineResult {
  const playerState = getPlayer(state, player);
  const { pendingTricks } = playerState;
  if (pendingTricks.length === 0) {
    return { state, events: [] };
  }

  const aliveOthers = getAlivePlayerNames(state).filter((p) => p !== player);
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

function batchProcessJudgments(state: GameState, player: string, tricks: PendingTrick[]): EngineResult {
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
    const tagAtoms = tags.map((tag) => ({ type: 'addTag' as const, player, tag }));
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
  let s: GameState = state;

  // 1. phaseBegin atom（写 serverLog）+ 显式 emitEvent 派 GameEvent 给技能钩子
  const beginResult = applyAtoms(s, [{ type: 'phaseBegin' as const, phase, player }]);
  s = beginResult.state;
  allEvents.push(...beginResult.events);
  const beginEvent = emitEvent(s, { type: 'phaseBegin' as const, phase, player });
  s = beginEvent.state;
  allEvents.push(...beginEvent.events);
  if (s.pending !== null) return { state: s, events: allEvents };

  // 2. 阶段内 actions
  if (phase === '判定') {
    const judgmentResult = processJudgmentPhase(s, player);
    s = judgmentResult.state;
    allEvents.push(...judgmentResult.events);
    if (s.pending !== null) return { state: s, events: allEvents };
  } else {
    const phaseActions = getPhaseActions(s, phase, player);
    if (phaseActions.length > 0) {
      const actionResult = applyAtoms(s, phaseActions);
      s = actionResult.state;
      allEvents.push(...actionResult.events);
    }
    if (s.pending !== null) return { state: s, events: allEvents };
  }

  const nextPhase = getNextPhase(phase);
  if (!nextPhase || nextPhase === phase) {
    return { state: s, events: allEvents };
  }

  // 3. phaseEnd atom（写 serverLog）+ 显式 emitEvent 派 GameEvent 给技能钩子
  const endResult = applyAtoms(s, [{ type: 'phaseEnd' as const, phase, player }]);
  s = endResult.state;
  allEvents.push(...endResult.events);
  const endEvent = emitEvent(s, { type: 'phaseEnd' as const, phase, player });
  s = endEvent.state;
  allEvents.push(...endEvent.events);
  if (s.pending !== null) return { state: s, events: allEvents };

  // 4. setPhase atom: 切 state.phase 字段（写在 phaseEnd 之后避免乱序）
  const { state: phaseState, events: phaseEvents } = applyAtoms(s, [
    { type: 'setPhase' as const, phase: nextPhase },
  ]);
  s = phaseState;
  allEvents.push(...phaseEvents);

  return { state: s, events: allEvents };
}

function getPhaseActions(state: GameState, phase: TurnPhase, player: string): Atom[] {
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

  // faceDown Mark 检查：玩家被翻面则跳过整回合（T-07 真 game rule）。
  // 与 shouldSkipPhase（skipPlay tag → 跳过出牌阶段）正交：faceDown 跳整回合。
  // 跳过路径：nextPlayer + clearExpiredMarks(turnEnd) 清理 untilTurnEnd player-scope
  // （untilPhaseEnd+player scope 不清，关系型 Mark 才在 turnEnd 清）。
  const faceDownMarks = (s.marks[s.currentPlayer] ?? []).filter(
    (m) =>
      m.id.startsWith('faceDown:') &&
      (m.duration === 'untilTurnEnd' || m.duration === 'untilPhaseEnd'),
  );
  if (faceDownMarks.length > 0) {
    const skipResult = applyAtoms(s, [
      { type: 'nextPlayer' },
      { type: 'clearExpiredMarks', phase: 'turnEnd' },
    ]);
    // nextPlayer atom 已把 turnStarted 重置为 false（见 engine/atoms/phase.ts）；
    // 显式再写一次以防御未来重构。
    s = { ...skipResult.state, turn: { ...skipResult.state.turn, turnStarted: false } };
    allEvents.push(...skipResult.events);
    return { state: s, events: allEvents };
  }

  // turnStart 防重：依赖 state.turn.turnStarted: boolean（nextPlayer atom 重置为 false）
  if (!s.turn.turnStarted) {
    // turnStart GameEvent 派发（技能钩子）
    const turnStartGameEvent: GameEvent = { type: 'turnStart', player: s.currentPlayer };
    const turnStartResult = emitEvent(s, turnStartGameEvent);
    s = turnStartResult.state;
    allEvents.push(...turnStartResult.events);
    // turnStart server event 走 atom 路径（写进 state.serverLog，详见 ADR 0011）
    const turnStartAtomResult = applyAtoms(s, [{ type: 'turnStart', player: s.currentPlayer }]);
    s = { ...turnStartAtomResult.state, turn: { ...turnStartAtomResult.state.turn, turnStarted: true } };
    allEvents.push(...turnStartAtomResult.events);
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
