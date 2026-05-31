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
import { advanceToInteractivePhase, isAutoPhase } from './phase-advance';

/** @deprecated 直接使用 skill.ts 的 registerSkill */
export function registerSkill(def: SkillDef): void {
  registerSkillToGlobal(def);
}

export function engine(state: GameState, action: GameAction): EngineResult {
  let result: EngineResult;

  if (action.type === 'startGame') {
    // startGame 跳过验证，直接返回当前状态（auto-advance 会处理 phase 推进）
    result = { state, events: [], error: undefined };
  } else if (state.pending) {
    result = handlePending(state, action);
  } else {
    const error = validateAction(state, action);
    if (error) return { state, events: [], error };

    switch (action.type) {
      case 'playCard':
        result = handlePlayCard(state, action);
        break;
      case 'endTurn':
        result = handleEndTurn(state, action);
        break;
      case 'useSkill':
        result = handleUseSkill(state, action, getSkillRegistry());
        break;
      case 'discard':
        return { state, events: [], error: '弃牌操作仅在弃牌阶段有效' };
      case 'respond':
        return { state, events: [], error: '响应动作仅在响应窗口中有效' };
      case 'skillChoice':
        return { state, events: [], error: '技能选择仅在技能提示中有效' };
      default:
        return { state, events: [], error: `未知操作: ${(action as any).type}` };
    }
  }

  if (result.error) return result;

  // 自动推进非交互阶段（准备→判定→摸牌→出牌）
  if (!result.state.pending) {
    const autoResult = advanceToInteractivePhase(result.state);
    result = {
      state: autoResult.state,
      events: [...result.events, ...autoResult.events],
    };
  }

  // deferredDyingCheck 检查（仅当没有 pending 时）
  if (!result.state.pending) {
    const check = result.state.deferredDyingCheck;
    if (check) {
      const target = getPlayer(result.state, check.player);
      if (target.health <= 0 && target.info.alive) {
        const dyingPending = createDyingPending(result.state, check.player, check.source);
        const { state: dyingState, events: dyingEvents } = applyAtoms(
          { ...result.state, deferredDyingCheck: undefined },
          [{ type: 'pushPending' as const, action: dyingPending }],
        );
        const dyingEvent = makeServerEvent('dying', {
          player: check.player,
          ...(check.source ? { source: check.source } : {}),
        });
        result = {
          state: dyingState,
          events: [...result.events, ...dyingEvents, dyingEvent],
        };
      } else {
        result = {
          state: { ...result.state, deferredDyingCheck: undefined },
          events: result.events,
        };
      }
    }
  }

  return result;
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
    default:
      return { state, events: [], error: `未知 pending 类型: ${(pending as any).type}` };
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
