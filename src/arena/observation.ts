import type { Card, GameView, ViewEvent } from '../engine/types';
import { TARGET_BROADCAST } from '../engine/types';
import type { AvailableAction, ChatMessage } from '../client/headless/types';
import { getActionsForPlayer } from '../client/skillActionRegistry';
import { resolveDistributeCardIds } from '../client/utils/gameViewHelpers';
import type { DistributePrompt } from '../engine/types';
import { projectView } from '../ai-mcp/viewProjector';
import type { ArenaObservation, ArenaMenuAction } from './types';

/** This boundary never trusts an audience/debug view to be a player's observation. */
export function playerView(view: GameView, viewer = view.viewer): GameView {
  return {
    ...view,
    viewer,
    players: view.players.map((p) => ({
      ...p,
      hand: p.index === viewer ? p.hand : undefined,
      identity: p.index === viewer || p.identity === '主公' || !p.alive ? p.identity : undefined,
      identityHidden: p.index !== viewer && p.alive && p.identity !== '主公',
    })),
  };
}

export function publicSnapshot(view: GameView) {
  return projectView(playerView(view, -1));
}

export function decisionWindowId(view: GameView): string {
  const pending = view.pending;
  const requestType = pending && 'requestType' in pending.atom ? pending.atom.requestType : '';
  return JSON.stringify([view.viewer, view.currentPlayerIndex, view.phase,
    pending?.target, pending?.atom.type, requestType, pending?.deadline ?? view.deadline]);
}

function referencedCards(value: unknown, cardMap: GameView['cardMap']): Card[] {
  const ids = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === 'string' && cardMap[item]) ids.add(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  return [...ids].map((id) => cardMap[id]);
}

function distributePromptFor(view: GameView, action: AvailableAction): DistributePrompt | undefined {
  const pending = view.pending;
  if (action.category === 'distribute' && pending?.target === view.viewer && pending.prompt.type === 'distribute') {
    return pending.prompt;
  }
  return getActionsForPlayer(view.viewer).find((candidate) =>
    candidate.skillId === action.message.skillId &&
    candidate.actionType === action.message.actionType &&
    candidate.prompt.type === 'distribute',
  )?.prompt as DistributePrompt | undefined;
}

function completeDistributeAction(view: GameView, action: ArenaMenuAction): void {
  const prompt = distributePromptFor(view, action);
  if (!prompt) return;
  const me = view.players[view.viewer];
  if (!me) return;
  const mode = prompt.mode ?? 'allocate';
  const cardIds = resolveDistributeCardIds(prompt, me.hand ?? [], me.equipment, view.cardMap);
  const isYiji = view.pending?.target === view.viewer &&
    'requestType' in view.pending.atom && view.pending.atom.requestType === '遗计/distribute';
  const minTotal = isYiji ? cardIds.length : Math.max(0, prompt.minTotal ?? 1);
  const maxTotal = prompt.maxTotal ?? 99;
  if (mode === 'select') {
    action.selection = { mode, cardIds, minTotal, maxTotal };
    if (Array.isArray(action.message.params.cardIds) && (action.message.params.cardIds as string[]).length === 0) {
      action.message.params.cardIds = cardIds.slice(0, minTotal);
    }
    return;
  }

  const legalTargets = action.validTargets.length
    ? action.validTargets
    : view.players.filter((p) => p.alive && (prompt.allowSelf !== false || p.index !== view.viewer) &&
      (!prompt.targetFilter || prompt.targetFilter(view, p.index))).map((p) => p.index);
  const targets = legalTargets.filter((target) => {
    const player = view.players[target];
    return !!player?.alive && (prompt.allowSelf !== false || target !== view.viewer) &&
      (!prompt.targetFilter || prompt.targetFilter(view, target));
  });
  const minPerTarget = prompt.minPerTarget ?? 1;
  const maxPerTarget = prompt.maxPerTarget ?? 99;
  action.selection = { mode, cardIds, targets, minTotal, maxTotal, minPerTarget, maxPerTarget, allowSelf: prompt.allowSelf !== false };
  if (Array.isArray(action.message.params.allocation) &&
    (action.message.params.allocation as unknown[]).length === 0 && targets.length && cardIds.length) {
    const requested = isYiji ? cardIds.length : Math.max(1, minTotal, minPerTarget);
    const count = Math.min(cardIds.length, maxPerTarget, requested);
    action.message.params.allocation = [{ target: targets[0], cardIds: cardIds.slice(0, count) }];
  }
}

export function createObservation(
  raw: GameView,
  seq: number,
  actions: AvailableAction[],
  publicChat: ChatMessage[] = [],
  recentEvents: ViewEvent[] = [],
): ArenaObservation {
  const view = playerView(raw);
  const decisionId = `${view.viewer}:${seq}`;
  // Only the addressed player receives the serialized full prompt. Other players' prompts
  // have already been redacted by the engine, and are not promoted to private knowledge here.
  const pending = view.pending;
  const privatePrompt = pending && (pending.target === view.viewer || pending.target === TARGET_BROADCAST)
    ? JSON.parse(JSON.stringify(pending)) as GameView['pending'] : null;
  const privateCards = referencedCards(privatePrompt, view.cardMap);
  const publicCards = (view.zones?.processing ?? []).map((id) => view.cardMap[id]).filter(Boolean);
  const revealedCards = referencedCards(recentEvents.filter((event) => ['展示', '判定'].includes(event.type)), view.cardMap);
  const menu: ArenaMenuAction[] = actions.map((action, index) => {
    const item: ArenaMenuAction = {
      ...action,
      actionId: `a${index}`,
      message: { ...action.message, params: { ...action.message.params }, baseSeq: seq },
    };
    if (item.category === 'distribute' && !('top' in item.message.params) && !('bottom' in item.message.params)) {
      completeDistributeAction(view, item);
    }
    return item;
  });
  return {
    decisionId,
    windowId: decisionWindowId(view),
    seq,
    state: projectView(view),
    privatePrompt,
    visibleCards: [
      ...(privateCards.length ? [{ visibility: 'private' as const, source: pending?.prompt.title ?? '技能询问', cards: privateCards }] : []),
      ...(publicCards.length ? [{ visibility: 'public' as const, source: '公开处理区', cards: publicCards }] : []),
      ...(revealedCards.length ? [{ visibility: 'public' as const, source: '公开展示或判定', cards: revealedCards }] : []),
    ],
    publicChat: publicChat.slice(-40),
    recentEvents,
    actions: menu,
  };
}
