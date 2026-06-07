import type {
  GameState,
  GameAction,
  EngineResult,
  PendingPlayPhase,
  SkillDef,
} from './types';
import { HookRegistry, clearAtomHooks, getDefaultHookRegistry } from './skill-hook';

import { validateAction } from './validate';
import './atoms/index';
import './phases/index';
import { resolveResponse, resolveSelectCard } from './handlers/response-handlers';
import { resumeSkill, handleUseSkill } from './handlers/skill-handlers';
import { resolveDiscardPhase, handleEndTurn } from './handlers/turn-handlers';
import { resolveDying } from './handlers/dying-handlers';
import { handlePlayCard, resolveHarvestSelection } from './handlers/card-handlers';
import { getPlayer, checkWinCondition } from './state';
import { applyAtoms, _setCurrentEngineHooks } from './atom';
import { createDyingPending } from './handlers/engine-utils';
import { makeServerEvent } from './event';
import { advanceToInteractivePhase } from './phase-advance';

export interface EngineConfig {
  skills: SkillDef[];
}

export interface EngineInstance {
  dispatch(state: GameState, action: GameAction): EngineResult;
  readonly skillsMap: ReadonlyMap<string, SkillDef>;
  readonly hooks: HookRegistry;
  /**
   * 重置全局 skill registry + atom hooks，重新注册本 instance 的 v3 hooks。
   *
   * 测试场景专用：在每个 test case 之前调用，确保隔离。
   * 旧 API 三件套 (clearSkillRegistry + clearAtomHooks + registerAllSkills)
   * 已被本方法替代。
   *
   * 注意：atom registry 的重置由各测试的 `registerAllAtoms()` 显式调用。
   */
  clearForTest(): void;
}

/**
 * 创建引擎实例。闭包持有独立的 skillsMap 和 hookRegistry。
 *
 * 当前阶段：内部仍通过全局 registry 调用 validateAction / emitEvent 等，
 * 因为这些函数尚未支持 skillsMap 参数。闭包内的 skillsMap 和 hookRegistry
 * 为未来多实例隔离做准备。
 */
export function createEngine(config: EngineConfig): EngineInstance {
  const skillsMap = new Map(config.skills.map(s => [s.id, s]));
  const hookRegistry = new HookRegistry();

  // 注册 v3 钩子
  for (const skill of config.skills) {
    skill.registerHooks?.(hookRegistry);
  }

  /**
   * 测试隔离：清空全局 skill registry + atom hooks，重新注册本 instance 的 v3 hooks。
   * 调用方需自己重新注册 atom registry（用 `registerAllAtoms()`）。
   */
  function clearForTest(): void {
    // [P5-T2] v3 时代：registerSkill 调用已无副作用（registry 不再用于 v2 trigger 派发）。
    // 闭包 hookRegistry + 全局 defaultHookRegistry 是 v3 钩子唯一通道——
    // 清空 + 重新注册本 instance 的 registerHooks。
    clearAtomHooks();
    hookRegistry.clear();
    // 重新注册本 instance 的所有 v3 钩子到闭包 + 全局
    // 优先保留含 registerHooks 的版本（v3），跳过同名占位版（equipment.ts 中的 v2 stub）
    const best = new Map<string, SkillDef>();
    for (const skill of config.skills) {
      if (!best.has(skill.id) || skill.registerHooks) {
        best.set(skill.id, skill);
      }
    }
    for (const skill of best.values()) {
      skill.registerHooks?.(hookRegistry);
      skill.registerHooks?.(getDefaultHookRegistry());
    }
  }

  function dispatchAction(state: GameState, action: GameAction): EngineResult {
    const error = validateAction(state, action);
    if (error) return { state, events: [], error };

    switch (action.type) {
      case '打出一张牌':
        return handlePlayCard(state, action);
      case '结束回合':
        return handleEndTurn(state, action);
      case '使用技能':
        return handleUseSkill(state, action, skillsMap);
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

  function handlePending(state: GameState, action: GameAction): EngineResult {
    const pending = state.pending!;
    let result: EngineResult;
    switch (pending.type) {
      case '响应窗口':
        result = resolveResponse(state, action, pending);
        break;
      case '技能选择':
        result = resumeSkill(state, action, pending, skillsMap);
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
      { hooks: hookRegistry },
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

  function dispatch(state: GameState, action: GameAction): EngineResult {
    // Phase 5 P2-1：让 applyAtoms 不传 opts 也能命中本 instance 闭包 hooks
    // try/finally 保证即使抛错也能清空
    const previousHooks = _setCurrentEngineHooks(hookRegistry);
    try {
      return dispatchInner(state, action);
    } finally {
      _setCurrentEngineHooks(previousHooks);
    }
  }

  function dispatchInner(state: GameState, action: GameAction): EngineResult {
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
      const { state: popState } = applyAtoms(state, [{ type: '弹出待定' }], { hooks: hookRegistry });
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
        const { state: pushState, events: pushEvents } = applyAtoms(result.state, [{ type: '推入待定', action: refreshedPending }], { hooks: hookRegistry });
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
            { hooks: hookRegistry },
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

  return {
    dispatch,
    get skillsMap() { return skillsMap; },
    get hooks() { return hookRegistry; },
    clearForTest,
  };
}
