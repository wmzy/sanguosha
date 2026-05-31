/**
 * engine/v2/phase-advance.ts — 回合阶段自动推进
 *
 * 自动执行"准备→判定→摸牌→出牌"的阶段性推进。
 * 每个阶段 emit phaseBegin 事件（触发监听该阶段的技能），
 * 并在特定阶段执行自动行为（摸牌阶段抽 2 张牌）。
 *
 * 只有出牌阶段和弃牌阶段需要玩家交互，其余阶段自动推进。
 */

import type { GameState, ServerEvent, EngineResult, GameEvent, Atom } from './types';
import type { TurnPhase } from '../../shared/types';
import { emitEvent, clearTurnVars } from './skill';
import { applyAtoms } from './handlers/engine-utils';
import { getPlayer } from './state';

/**
 * 处理判定阶段的延迟锦囊（乐不思蜀、兵粮寸断）
 *
 * 三国杀规则：
 * - 乐不思蜀：判定牌不是红桃♥时生效（跳过出牌阶段）
 * - 兵粮寸断：判定牌不是梅花♣时生效（跳过摸牌阶段）
 */
function processJudgmentPhase(state: GameState, player: string): EngineResult {
  const playerState = getPlayer(state, player);
  const tricks = [...playerState.pendingTricks];
  if (tricks.length === 0) {
    return { state, events: [] };
  }

  const atoms: Atom[] = [];
  const phaseFlags: string[] = [];

  for (let i = tricks.length - 1; i >= 0; i--) {
    const trick = tricks[i];
    const judgeVarKey = `judgeResult_${trick.name}_${i}`;
    atoms.push({ type: 'judge', player, varKey: judgeVarKey });

    const { suit } = peekJudgeCard(state);

    if (trick.name === '乐不思蜀') {
      if (suit !== '♥') {
        phaseFlags.push('skipPlay');
      }
    } else if (trick.name === '兵粮寸断') {
      if (suit !== '♣') {
        phaseFlags.push('skipDraw');
      }
    }

    atoms.push({ type: 'removePendingTrick', player, index: i });
  }

  atoms.push(...phaseFlags.map(flag => ({ type: 'addTag' as const, player, tag: flag })));

  const actionResult = applyAtoms(state, atoms);
  return { state: actionResult.state, events: actionResult.events };
}

function peekJudgeCard(state: GameState): { cardId: string | null; suit: string } {
  if (state.zones.deck.length === 0) {
    return { cardId: null, suit: '♣' };
  }
  const cardId = state.zones.deck[state.zones.deck.length - 1];
  const card = state.cardMap[cardId];
  return { cardId, suit: card?.suit ?? '♣' };
}

export function isAutoPhase(phase: string): boolean {
  return phase === '准备' || phase === '判定' || phase === '摸牌';
}

function processPhaseStep(state: GameState): EngineResult {
  const phase = state.phase;
  const player = state.currentPlayer;
  const allEvents: ServerEvent[] = [];

  const phaseBeginEvent: GameEvent = { type: 'phaseBegin', phase, player };
  const emitResult = emitEvent(state, phaseBeginEvent);
  allEvents.push(...emitResult.events);

  if (emitResult.state.pending !== null) {
    return { state: emitResult.state, events: allEvents };
  }

  let s = emitResult.state;

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
      return [{ type: 'draw' as const, player, count: 2 }];
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

  while (s.pending === null && isAutoPhase(s.phase)) {
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

  return { state: s, events: allEvents };
}
