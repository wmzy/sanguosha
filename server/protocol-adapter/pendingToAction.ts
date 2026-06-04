import type { GameAction, Json, PendingAction } from '../../engine/types';

export function pendingToRespondAction(
  _pending: Extract<PendingAction, { type: 'responseWindow' } | { type: 'dyingWindow' }>,
  playerName: string,
  choice: unknown,
): GameAction {
  const cardId = typeof choice === 'string' ? choice : undefined;
  return { type: 'respond', player: playerName, cardId };
}

export function pendingToDiscardAction(
  _pending: Extract<PendingAction, { type: 'discardPhase' }>,
  playerName: string,
  choice: unknown,
): GameAction {
  const cardIds = Array.isArray(choice) ? (choice as string[]) : [];
  return { type: 'discard', player: playerName, cardIds };
}

export function pendingToSkillChoiceAction(
  _pending: Extract<PendingAction, { type: 'skillPrompt' }>,
  playerName: string,
  choice: unknown,
): GameAction {
  return { type: 'skillChoice', player: playerName, choice: choice as Json };
}

export function pendingToSelectCardAction(
  _pending: Extract<PendingAction, { type: 'selectCard' }>,
  playerName: string,
  choice: unknown,
): GameAction {
  const cardIds = Array.isArray(choice)
    ? (choice as string[])
    : typeof choice === 'string'
      ? [choice]
      : [];
  return { type: 'respond', player: playerName, cardIds };
}

/** 未知 pending 类型返回 null */
export function pendingToAction(
  pending: PendingAction,
  playerName: string,
  choice: unknown,
): GameAction | null {
  switch (pending.type) {
    case 'responseWindow':
    case 'dyingWindow':
      return pendingToRespondAction(pending, playerName, choice);
    case 'discardPhase':
      return pendingToDiscardAction(pending, playerName, choice);
    case 'skillPrompt':
      return pendingToSkillChoiceAction(pending, playerName, choice);
    case 'selectCard':
      return pendingToSelectCardAction(pending, playerName, choice);
    default:
      return null;
  }
}
