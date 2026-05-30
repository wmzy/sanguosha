import type {
  GameState,
  GameAction,
  EngineResult,
  PendingResponseWindow,
  PendingSkillPrompt,
  PendingDiscardPhase,
  PendingDyingWindow,
  SkillDef,
} from './types';
import { validateAction } from './validate';
import './atoms/index';
import './phases/index';
import './skills/index';
import { resolveResponse } from './handlers/response-handlers';
import { resumeSkill, handleUseSkill } from './handlers/skill-handlers';
import { resolveDiscardPhase, handleEndTurn } from './handlers/turn-handlers';
import { resolveDying } from './handlers/dying-handlers';
import { handlePlayCard } from './handlers/card-handlers';
import { getSkillRegistry, registerSkill as registerSkillToGlobal } from './skill';

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
  switch (pending.type) {
    case 'responseWindow':
      return resolveResponse(state, action, pending);
    case 'skillPrompt':
      return resumeSkill(state, action, pending, getSkillRegistry());
    case 'discardPhase':
      return resolveDiscardPhase(state, action, pending);
    case 'dyingWindow':
      return resolveDying(state, action, pending);
  }
}
