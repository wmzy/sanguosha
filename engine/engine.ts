import type {
  GameState,
  GameAction,
  EngineResult,
  PendingPlayPhase,
} from './types';
import { validateAction } from './validate';
import './atoms/index';
import './phases/index';
import './skills/index';
import { resolveResponse, resolveSelectCard } from './handlers/response-handlers';
import { resumeSkill, handleUseSkill } from './handlers/skill-handlers';
import { resolveDiscardPhase, handleEndTurn } from './handlers/turn-handlers';
import { resolveDying } from './handlers/dying-handlers';
import { handlePlayCard, resolveHarvestSelection } from './handlers/card-handlers';
import { getSkillRegistry } from './skill';
import { getPlayer, checkWinCondition } from './state';
import { applyAtoms, createDyingPending } from './handlers/engine-utils';
import { makeServerEvent } from './event';
import { advanceToInteractivePhase } from './phase-advance';

function dispatchAction(state: GameState, action: GameAction): EngineResult {
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
    case 'toggleAutoSkipWuxie':
      return {
        state: { ...state, meta: { ...state.meta, autoSkipWuxie: !state.meta.autoSkipWuxie } },
        events: [],
      };
    case 'startGame':
      return { state, events: [], error: undefined };
    default: {
      const t = (action as { type: string }).type;
      return { state, events: [], error: `未知操作: ${t}` };
    }
  }
}

export function engine(state: GameState, action: GameAction): EngineResult {
  let result: EngineResult;

  if (action.type === 'startGame') {
    result = { state, events: [], error: undefined };
  } else if (action.type === 'toggleAutoSkipWuxie') {
    result = {
      state: { ...state, meta: { ...state.meta, autoSkipWuxie: !state.meta.autoSkipWuxie } },
      events: [],
    };
  } else if (state.pending?.type === 'playPhase') {
    const playPhaseActions: GameAction['type'][] = ['playCard', 'useSkill', 'endTurn', 'toggleAutoSkipWuxie'];
    if (!playPhaseActions.includes(action.type)) {
      return { state, events: [], error: '出牌阶段不允许此操作' };
    }
    const { state: popState } = applyAtoms(state, [{ type: 'popPending' }]);
    const savedPending = state.pending;
    result = dispatchAction(popState, action);
    if (!result.error && !result.state.pending && result.state.meta.status !== '已结束' && result.state.phase === '出牌') {
      const refreshedPending: PendingPlayPhase = {
        id: savedPending.id,
        type: 'playPhase',
        player: savedPending.player,
        timeout: savedPending.timeout,
        deadline: Date.now() + savedPending.timeout,
        onTimeout: savedPending.onTimeout,
      };
      const { state: pushState, events: pushEvents } = applyAtoms(result.state, [{ type: 'pushPending', action: refreshedPending }]);
      result = { state: pushState, events: [...result.events, ...pushEvents] };
    }
  } else if (state.pending) {
    result = handlePending(state, action);
  } else {
    result = dispatchAction(state, action);
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

  // 胜利条件检查
  if (!result.state.pending) {
    const win = checkWinCondition(result.state);
    if (win) {
      const gameOverEvent = makeServerEvent('gameOver', {
        winner: win.winner,
        reason: win.reason,
      });
      return {
        state: {
          ...result.state,
          meta: { ...result.state.meta, status: '已结束', winner: win.winner },
          pending: null,
        },
        events: [...result.events, gameOverEvent],
      };
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
    case 'harvestSelection':
      result = resolveHarvestSelection(state, action, pending);
      break;
    default: {
      const t = (pending as { type: string }).type;
      return { state, events: [], error: `未知 pending 类型: ${t}` };
    }
  }

  if (result.error || result.state.pending) return result;

  const check = result.state.deferredDyingCheck;
  if (!check) {
    const win = checkWinCondition(result.state);
    if (win) {
      const gameOverEvent = makeServerEvent('gameOver', {
        winner: win.winner,
        reason: win.reason,
      });
      return {
        state: {
          ...result.state,
          meta: { ...result.state.meta, status: '已结束', winner: win.winner },
          pending: null,
        },
        events: [...result.events, gameOverEvent],
      };
    }
    return result;
  }

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
