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
import { applyAtoms } from './atom';
import { createDyingPending } from './handlers/engine-utils';
import { makeServerEvent } from './event';
import { advanceToInteractivePhase } from './phase-advance';

function dispatchAction(state: GameState, action: GameAction): EngineResult {
  const error = validateAction(state, action);
  if (error) return { state, events: [], error };

  switch (action.type) {
    case '打出一张牌':
      return handlePlayCard(state, action);
    case '结束回合':
      return handleEndTurn(state, action);
    case '使用技能':
      return handleUseSkill(state, action, getSkillRegistry());
    case '弃置':
      return { state, events: [], error: '弃牌操作仅在弃牌阶段有效' };
    case '打出':
      return { state, events: [], error: '响应动作仅在响应窗口中有效' };
    case '技能选择':
      return { state, events: [], error: '技能选择仅在技能提示中有效' };
    case '切换自动跳过无懈可击':
      return {
        state: { ...state, meta: { ...state.meta, autoSkipWuxie: !state.meta.autoSkipWuxie } },
        events: [],
      };
    case '开始':
      return { state, events: [], error: undefined };
    default: {
      const t = (action as { type: string }).type;
      return { state, events: [], error: `未知操作: ${t}` };
    }
  }
}

export function engine(state: GameState, action: GameAction): EngineResult {
  let result: EngineResult;

  if (action.type === '开始') {
    result = { state, events: [], error: undefined };
  } else if (action.type === '切换自动跳过无懈可击') {
    result = {
      state: { ...state, meta: { ...state.meta, autoSkipWuxie: !state.meta.autoSkipWuxie } },
      events: [],
    };
  } else if (state.pending?.type === '出牌阶段') {
    const playPhaseActions: GameAction['type'][] = ['打出一张牌', '使用技能', '结束回合', '切换自动跳过无懈可击'];
    if (!playPhaseActions.includes(action.type)) {
      return { state, events: [], error: '出牌阶段不允许此操作' };
    }
    const { state: popState } = applyAtoms(state, [{ type: '弹出待定' }]);
    const savedPending = state.pending;
    result = dispatchAction(popState, action);
    if (!result.error && !result.state.pending && result.state.meta.status !== '已结束' && result.state.phase === '出牌') {
      const refreshedPending: PendingPlayPhase = {
        id: savedPending.id,
        type: '出牌阶段',
        player: savedPending.player,
        timeout: savedPending.timeout,
        deadline: Date.now() + savedPending.timeout,
        onTimeout: savedPending.onTimeout,
      };
      const { state: pushState, events: pushEvents } = applyAtoms(result.state, [{ type: '推入待定', action: refreshedPending }]);
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
          [{ type: '推入待定' as const, action: dyingPending }],
        );
        const dyingEvent = makeServerEvent('濒死', {
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
    case '响应窗口':
      result = resolveResponse(state, action, pending);
      break;
    case '技能选择':
      result = resumeSkill(state, action, pending, getSkillRegistry());
      break;
    case '弃牌阶段':
      result = resolveDiscardPhase(state, action, pending);
      break;
    case '濒死窗口':
      result = resolveDying(state, action, pending);
      break;
    case '选择牌':
      result = resolveSelectCard(state, action, pending);
      break;
    case '收获选牌':
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
    [{ type: '推入待定' as const, action: dyingPending }],
  );
  const dyingEvent = makeServerEvent('濒死', {
    player: check.player,
    ...(check.source ? { source: check.source } : {}),
  });
  return {
    state: dyingState,
    events: [...result.events, ...dyingEvents, dyingEvent],
  };
}
