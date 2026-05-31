import type {
  GameState,
  GameAction,
  EngineResult,
  PendingResponseWindow,
  PendingSkillPrompt,
  PendingDiscardPhase,
  PendingDyingWindow,
  PendingSelectCard,
  SkillDef,
  Atom,
} from './types';
import { validateAction } from './validate';
import './atoms/index';
import './phases/index';
import './skills/index';
import { resolveResponse, resolveSelectCard } from './handlers/response-handlers';
import { resumeSkill, handleUseSkill } from './handlers/skill-handlers';
import { resolveDiscardPhase, handleEndTurn } from './handlers/turn-handlers';
import { resolveDying } from './handlers/dying-handlers';
import { handlePlayCard } from './handlers/card-handlers';
import { getSkillRegistry, registerSkill as registerSkillToGlobal } from './skill';
import { getPlayer } from './state';
import { applyAtoms, createDyingPending } from './handlers/engine-utils';
import { makeServerEvent } from './event';

/** @deprecated 直接使用 skill.ts 的 registerSkill */
export function registerSkill(def: SkillDef): void {
  registerSkillToGlobal(def);
}

export function engine(state: GameState, action: GameAction): EngineResult {
  if (state.pending) {
    return handlePending(state, action);
  }

  const error = validateAction(state, action);
  if (error) return { state, events: [], error };

  switch (action.type) {
    case 'playCard':
      return handlePlayCard(state, action);
    case 'endTurn':
      return handleEndTurn(state, action);
    case 'useSkill':
      return handleUseSkill(state, action, getSkillRegistry());
    case 'discard':
      return { state, events: [], error: '弃牌操作仅在弃牌阶段有效' };
    case 'respond':
      return { state, events: [], error: '响应动作仅在响应窗口中有效' };
    case 'skillChoice':
      return { state, events: [], error: '技能选择仅在技能提示中有效' };
  }
}

function handlePending(state: GameState, action: GameAction): EngineResult {
  const pending = state.pending!;
  let result: EngineResult;
  switch (pending.type) {
    case 'responseWindow':
      result = resolveResponse(state, action, pending);
      break;
    case 'skillPrompt':
      result = resumeSkill(state, action, pending, getSkillRegistry());
      break;
    case 'discardPhase':
      result = resolveDiscardPhase(state, action, pending);
      break;
    case 'dyingWindow':
      result = resolveDying(state, action, pending);
      break;
    case 'selectCard':
      result = resolveSelectCard(state, action, pending);
      break;
  }

  if (result.error || result.state.pending) return result;

  const check = result.state.deferredDyingCheck;
  if (!check) return result;

  const target = getPlayer(result.state, check.player);
  if (target.health > 0 || !target.info.alive) {
    return { state: { ...result.state, deferredDyingCheck: undefined }, events: result.events };
  }

  const dyingPending = createDyingPending(result.state, check.player, check.source);
  const { state: dyingState, events: dyingEvents } = applyAtoms(
    { ...result.state, deferredDyingCheck: undefined },
    [{ type: 'pushPending' as const, action: dyingPending }],
  );
  const dyingEvent = makeServerEvent('dying', {
    player: check.player,
    ...(check.source ? { source: check.source } : {}),
  });
  return {
    state: dyingState,
    events: [...result.events, ...dyingEvents, dyingEvent],
  };
}
