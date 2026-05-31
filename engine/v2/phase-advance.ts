/**
 * engine/v2/phase-advance.ts — 回合阶段自动推进
 *
 * 自动执行"准备→判定→摸牌→出牌"的阶段性推进。
 * 每个阶段 emit phaseBegin 事件（触发监听该阶段的技能），
 * 并在特定阶段执行自动行为（摸牌阶段抽 2 张牌）。
 *
 * 只有出牌阶段和弃牌阶段需要玩家交互，其余阶段自动推进。
 */

import type { GameState, ServerEvent, EngineResult, GameEvent } from './types';
import type { TurnPhase } from '../../shared/types';
import { emitEvent, clearTurnVars } from './skill';
import { applyAtoms } from './handlers/engine-utils';

/** 不需要玩家交互、应自动推进的阶段 */
export function isAutoPhase(phase: string): boolean {
  return phase === '准备' || phase === '判定' || phase === '摸牌';
}

/** 处理单个阶段的推进：emit 事件 → 阶段行为 → 切换阶段 */
function processPhaseStep(state: GameState): EngineResult {
  const phase = state.phase;
  const player = state.currentPlayer;
  const allEvents: ServerEvent[] = [];

  // 1. emit phaseBegin 事件（可能触发监听此阶段的技能）
  const phaseBeginEvent: GameEvent = { type: 'phaseBegin', phase, player };
  const emitResult = emitEvent(state, phaseBeginEvent);
  allEvents.push(...emitResult.events);

  if (emitResult.state.pending !== null) {
    return { state: emitResult.state, events: allEvents };
  }

  let s = emitResult.state;

  // 2. 执行阶段特有行为
  const phaseActions = getPhaseActions(phase, player);
  if (phaseActions.length > 0) {
    const actionResult = applyAtoms(s, phaseActions);
    s = actionResult.state;
    allEvents.push(...actionResult.events);
  }

  if (s.pending !== null) {
    return { state: s, events: allEvents };
  }

  // 3. 切换到下一阶段
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

/** 获取当前阶段的自动行为（无需玩家交互的原子操作） */
function getPhaseActions(phase: TurnPhase, player: string): import('./types').Atom[] {
  switch (phase) {
    case '准备':
      return [];
    case '摸牌':
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

/** 从当前阶段推进到下一个需要玩家交互的阶段 */
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

  return { state: s, events: allEvents };
}
