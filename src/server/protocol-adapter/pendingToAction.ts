import type { GameAction, Json, PendingAction } from '../../engine/types';

export function pendingToRespondAction(
  _pending: Extract<PendingAction, { type: '响应窗口' } | { type: '濒死窗口' }>,
  playerName: string,
  choice: unknown,
): GameAction {
  const cardId = typeof choice === 'string' ? choice : undefined;
  return { type: '打出', player: playerName, cardId };
}

export function pendingToDiscardAction(
  _pending: Extract<PendingAction, { type: '弃牌阶段' }>,
  playerName: string,
  choice: unknown,
): GameAction {
  const cardIds = Array.isArray(choice) ? (choice as string[]) : [];
  return { type: '弃置', player: playerName, cardIds };
}

export function pendingToSkillChoiceAction(
  _pending: Extract<PendingAction, { type: '技能选择' }>,
  playerName: string,
  choice: unknown,
): GameAction {
  return { type: '技能选择', player: playerName, choice: choice as Json };
}

export function pendingToSelectCardAction(
  _pending: Extract<PendingAction, { type: '选择牌' }>,
  playerName: string,
  choice: unknown,
): GameAction {
  const cardIds = Array.isArray(choice)
    ? (choice as string[])
    : typeof choice === 'string'
      ? [choice]
      : [];
  return { type: '打出', player: playerName, cardIds };
}

/** 未知 pending 类型返回 null */
export function pendingToAction(
  pending: PendingAction,
  playerName: string,
  choice: unknown,
): GameAction | null {
  switch (pending.type) {
    case '响应窗口':
    case '濒死窗口':
      return pendingToRespondAction(pending, playerName, choice);
    case '弃牌阶段':
      return pendingToDiscardAction(pending, playerName, choice);
    case '技能选择':
      return pendingToSkillChoiceAction(pending, playerName, choice);
    case '选择牌':
      return pendingToSelectCardAction(pending, playerName, choice);
    default:
      return null;
  }
}
