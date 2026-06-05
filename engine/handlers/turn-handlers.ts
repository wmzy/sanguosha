import type {
  GameState,
  GameAction,
  EngineResult,
  Atom,
  PendingDiscardPhase,
  GameEvent,
} from '../types';
import { TIMEOUT_DEFAULTS } from '../types';
import { getPlayer } from '../state';
import { makeServerEvent } from '../event';
import { applyAtoms } from '../atom';
import { createPendingId } from '../atoms/pending';
import { emitEvent } from '../skill';

export function handleEndTurn(
  state: GameState,
  action: GameAction & { type: 'endTurn' },
): EngineResult {
  const player = action.player;

  // 触发 turnEnd 事件，使依赖此事件的技能可以响应（如闭月）
  const turnEndEvent: GameEvent = { type: 'turnEnd', player };
  const turnEndResult = emitEvent(state, turnEndEvent);
  if (turnEndResult.state.pending !== null) {
    return turnEndResult;
  }

  // 使用 turnEnd 后的最新状态
  const s = turnEndResult.state;
  const turnEndLogEvent = makeServerEvent('turnEnd', { player });
  const playerState = getPlayer(s, player);
  const handSize = playerState.hand.length;
  const health = playerState.health;

  if (handSize > health) {
    // 需要弃牌
    const discardCount = handSize - health;
    const pending: PendingDiscardPhase = {
      id: createPendingId(),
      type: 'discardPhase',
      player,
      min: discardCount,
      max: discardCount,
      timeout: TIMEOUT_DEFAULTS.discardPhase,
      deadline: Date.now() + TIMEOUT_DEFAULTS.discardPhase,
      onTimeout: { type: 'discard', player, cardIds: playerState.hand.slice(0, discardCount) },
    };
    const atoms: Atom[] = [
      { type: 'setPhase', phase: '弃牌' },
      { type: 'pushPending', action: pending },
    ];
    const result = applyAtoms(s, atoms);
    return { state: result.state, events: [...turnEndResult.events, ...result.events, turnEndLogEvent] };
  }

  // 不需要弃牌 → 下一玩家，从准备阶段开始
  // turnStart GameEvent + ServerEvent 由 advanceToInteractivePhase 统一发射
  const atoms: Atom[] = [
    { type: 'nextPlayer' },
    { type: 'setPhase', phase: '准备' },
  ];
  const result = applyAtoms(s, atoms);
  return {
    state: result.state,
    events: [...turnEndResult.events, ...result.events, turnEndLogEvent],
  };
}

export function resolveDiscardPhase(
  state: GameState,
  action: GameAction,
  pending: PendingDiscardPhase,
): EngineResult {
  if (action.type !== 'discard') {
    return { state, events: [], error: '弃牌阶段需要 discard 动作' };
  }
  if (action.player !== pending.player) {
    return { state, events: [], error: '只有当前玩家可以弃牌' };
  }
  if (action.cardIds.length < pending.min || action.cardIds.length > pending.max) {
    return { state, events: [], error: `需要弃 ${pending.min}~${pending.max} 张牌` };
  }

  // 验证卡牌在手牌中
  const playerState = getPlayer(state, action.player);
  for (const id of action.cardIds) {
    if (!playerState.hand.includes(id)) {
      return { state, events: [], error: `卡牌 ${id} 不在手牌中` };
    }
  }

  // 弃牌 → 弹出 pending → 下一玩家，从准备阶段开始
  const discardAtoms: Atom[] = [
    ...action.cardIds.map(
      (cardId) =>
        ({
          type: 'moveCard',
          cardId,
          from: { zone: 'hand', player: action.player },
          to: { zone: 'discardPile' },
        }) satisfies Atom,
    ),
    { type: 'popPending' },
    { type: 'nextPlayer' },
    { type: 'setPhase', phase: '准备' },
  ];
  const result = applyAtoms(state, discardAtoms);

  return {
    state: result.state,
    events: result.events,
  };
}
