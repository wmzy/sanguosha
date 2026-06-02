import type { GameAction, PendingAction } from '@engine/v2/types';
import type { PlayerView, AvailableAction, ValidationResult } from './types';

export function isValidAction(view: PlayerView, action: GameAction): ValidationResult {
  switch (action.type) {
    case 'playCard':
      return validatePlayCard(view, action);
    case 'respond':
      return validateRespond(view, action);
    case 'endTurn':
      return validateEndTurn(view, action);
    case 'discard':
      return validateDiscard(view, action);
    case 'useSkill':
      return { valid: true };
    case 'skillChoice':
      return { valid: true };
    case 'startGame':
      return { valid: true };
    case 'toggleAutoSkipWuxie':
      return { valid: true };
  }
}

function findCardInHand(view: PlayerView, cardId: string) {
  return view.self.hand.find(c => c.id === cardId);
}

function validatePlayCard(
  view: PlayerView,
  action: GameAction & { type: 'playCard' },
): ValidationResult {
  const card = findCardInHand(view, action.cardId);
  if (!card) return { valid: false, reason: '手牌中没有此牌' };

  if (card.name === '杀') {
    if (view.turn.phase !== '出牌') return { valid: false, reason: '当前不是出牌阶段' };
    if (view.turn.killsPlayed >= 1) {
      return { valid: false, reason: '本回合已使用过杀' };
    }
    if (!action.target) return { valid: false, reason: '杀需要指定目标' };
    return { valid: true };
  }

  if (card.name === '闪') {
    return { valid: false, reason: '闪不能主动使用' };
  }

  if (card.name === '桃') {
    if (view.self.health >= view.self.maxHealth) {
      return { valid: false, reason: '体力已满' };
    }
    return { valid: true };
  }

  if (card.name === '过河拆桥' || card.name === '顺手牵羊' || card.name === '决斗') {
    if (!action.target) return { valid: false, reason: '需要指定目标' };
    return { valid: true };
  }

  return { valid: true };
}

function validateRespond(
  view: PlayerView,
  action: GameAction & { type: 'respond' },
): ValidationResult {
  if (!action.cardId) return { valid: true };

  const card = findCardInHand(view, action.cardId);
  if (!card) return { valid: false, reason: '手牌中没有此牌' };

  return { valid: true };
}

function validateEndTurn(
  view: PlayerView,
  _action: GameAction & { type: 'endTurn' },
): ValidationResult {
  if (view.turn.phase !== '出牌') {
    return { valid: false, reason: '当前不是出牌阶段' };
  }
  return { valid: true };
}

function validateDiscard(
  view: PlayerView,
  action: GameAction & { type: 'discard' },
): ValidationResult {
  for (const id of action.cardIds) {
    if (!findCardInHand(view, id)) {
      return { valid: false, reason: '弃牌中包含不在手牌的卡牌' };
    }
  }
  return { valid: true };
}

const NO_TARGET_CARDS = new Set([
  '桃园结义', '五谷丰登', '万箭齐发', '南蛮入侵', '无中生有',
]);

export function getAvailableActions(
  view: PlayerView,
  pending: PendingAction | null,
): AvailableAction[] {
  if (pending) {
    return getPendingActions(view, pending);
  }

  if (view.turn.phase === '出牌') {
    return getPlayPhaseActions(view);
  }

  return [];
}

function getPendingActions(view: PlayerView, pending: PendingAction): AvailableAction[] {
  switch (pending.type) {
    case 'responseWindow': {
      const cards = getResponseCards(view, pending.window.type);
      if (cards.length === 0) return [];
      return [{ type: 'respond', validTargets: cards.map(c => c.id), required: false }];
    }
    case 'discardPhase': {
      const handIds = view.self.hand.map(c => c.id);
      return [{
        type: 'discard',
        validTargets: handIds,
        required: true,
        sourceId: `discard-${pending.min}-${pending.max}`,
      }];
    }
    case 'dyingWindow': {
      const peaches = view.self.hand.filter(c => c.name === '桃');
      if (peaches.length === 0) return [];
      return [{ type: 'respond', validTargets: peaches.map(c => c.id), required: false }];
    }
    default:
      return [];
  }
}

function getResponseCards(view: PlayerView, windowType: string) {
  switch (windowType) {
    case 'killResponse':
      return view.self.hand.filter(c => c.name === '闪');
    case 'duelResponse':
      return view.self.hand.filter(c => c.name === '杀');
    case 'aoeResponse':
      return view.self.hand.filter(c => c.name === '杀' || c.name === '闪');
    case 'dyingResponse':
      return view.self.hand.filter(c => c.name === '桃');
    default:
      return [];
  }
}

function getPlayPhaseActions(view: PlayerView): AvailableAction[] {
  const actions: AvailableAction[] = [];
  const others = Object.keys(view.others);

  for (const card of view.self.hand) {
    const targets = getTargetsForCard(view, card, others);
    if (targets === null) continue;
    actions.push({ type: 'playCard', sourceId: card.id, validTargets: targets, required: false });
  }

  return actions;
}

function getTargetsForCard(
  view: PlayerView,
  card: { name: string; type: string },
  others: string[],
): string[] | null {
  if (card.name === '闪') return null;
  if (card.name === '无懈可击') return null;

  if (card.name === '杀') return others;
  if (card.name === '桃') {
    return view.self.health < view.self.maxHealth ? ['self'] : [];
  }
  if (card.name === '过河拆桥' || card.name === '顺手牵羊' || card.name === '决斗') {
    return others;
  }
  if (NO_TARGET_CARDS.has(card.name)) return [];

  if (card.type === '装备牌') return [];

  return others;
}
