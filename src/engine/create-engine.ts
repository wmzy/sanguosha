// src/engine/create-engine.ts
// 引擎主入口。两种 dispatch 路径:
//
// 1) 主动 action(无 pending slot):→ 调用 entry.execute(api) → 技能内部 pushFrame →
//    apply atom → 等待 fireDispatchReady(挂起点)或 execute 完成。返回当前 state。
//
// 2) 回应 action(有 pending slot):merge message.params 到 topFrame.params →
//    调用 entry.execute(api)(回应技能内部也 pushFrame) → consume pending →
//    等原始 execute 恢复 → 返回最新 state。
//
// 帧由技能在 execute 中显式创建(api.pushFrame);execute 结束后引擎自动弹栈。
// atomStack / pendingSlot 是 GameState 属性,不是 frame 属性。
// 引擎内部不 try/catch——除 bug 外不应抛错。
// actionLog 由引擎自动记录,session 不直接 mutate state。

import type {
  ClientMessage,
  EngineApi,
  GameState,
  GameView,
  Skill,
} from './types';
import { createGameState } from './types';
import { buildView } from './view/buildView';
import {
  clearAllSkillInstances,
  findActionEntry,
  getSkillModule,
  makeBackendAPI,
  setRuntimeApi,
  setSkillInstanceUnload,
} from './skill';
import { createEngineApi, type EngineContext } from './engine-api';
import { clearEvents } from './event-stream';
import { topFrame } from './settlement';

export interface DispatchResult {
  state: GameState;
  error?: string;
  /** 游戏是否结束 */
  gameOver?: boolean;
  /** 获胜者名字(游戏结束时) */
  winner?: string;
}

/** 空闲超时信息 */
export interface EngineInstance {
  dispatch(message: ClientMessage): Promise<DispatchResult>;
  buildView(viewer: number): GameView;
  resetForTest(): void;
  bootstrap(initialState: GameState): GameState;
  /** 获取当前 state(只读) */
  getState(): GameState;
}



export function createEngine(): EngineInstance {
  let currentState: GameState;

  function bootstrap(state: GameState): GameState {
    state = ensureStateShape(state);
    // 设置 startedAt
    if (!state.startedAt) {
      state = { ...state, startedAt: Date.now() };
    }
    currentState = state;
    for (const player of state.players) {
      for (const skillId of player.skills) {
        instantiateSkill(skillId, player.name);
      }
    }
    return state;
  }

  function instantiateSkill(skillId: string, ownerId: string): Skill {
    const module = getSkillModule(skillId);
    const skill = module.createSkill(skillId, ownerId);
    if (module.onInit) {
      const api = makeBackendAPI(skill);
      const unload = module.onInit(skill, api);
      setSkillInstanceUnload(skillId, ownerId, typeof unload === 'function' ? unload : () => {});
    }
    return skill;
  }

  /** 构造 EngineApi(每次 dispatch 调用创建一个新的) */
  function makeApi(
    state: GameState,
    self: string,
    messageParams: Record<string, import('./types').Json>,
    fireDispatchReady: () => void,
  ): { api: EngineApi; ctx: EngineContext } {
    const ctx: EngineContext = { state, self, messageParams, fireDispatchReady };
    const api = createEngineApi(ctx);
    return { api, ctx };
  }

  // 当前活跃的 execute 上下文、api 和 Promise(供回应路径读取原始 execute 的 state)
  let activeExecuteCtx: EngineContext | undefined;
  let activeExecuteApi: EngineApi | undefined;
  let activeExecuteP: Promise<void> | undefined;

  /** 检查游戏是否结束 */
  function checkGameOver(): { gameOver: boolean; winner?: string } {
    const aliveCount = currentState.players.filter(p => p.alive).length;
    if (aliveCount <= 1) {
      const winner = currentState.players.find(p => p.alive);
      return { gameOver: true, winner: winner?.name ?? '无人' };
    }
    return { gameOver: false };
  }

  /** 记录 action 到 actionLog */
  function logAction(message: ClientMessage): void {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now() - currentState.startedAt,
      message,
      baseSeq: message.baseSeq ?? -1,
    };
    currentState = {
      ...currentState,
      actionLog: [...currentState.actionLog, entry],
    };
  }

  async function dispatch(message: ClientMessage): Promise<DispatchResult> {
    const frame = topFrame(currentState);

    // === 回应路径(已有 pending slot) ===
    if (currentState.pendingSlot) {
      const slot = currentState.pendingSlot;
      const target = slot.definition.pending?.getTarget
        ? slot.definition.pending.getTarget(slot.atom)
        : '';
      if (message.ownerId !== target) {
        return { state: currentState };
      }

      // 合并回应 params 到 topFrame.params
      if (frame) {
        frame.params = { ...frame.params, ...message.params, __responder: message.ownerId };
      }

      // 尝试找到对应的 action entry
      const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
      if (entry) {
        const view = buildView(currentState, getViewerIndex(currentState, message.ownerId));
        const err = entry.validate(view, message.params);
        if (err === null) {
          // 构造 api,执行回应 action
          const { api, ctx } = makeApi(currentState, message.ownerId, { ...message.params }, () => {});
          setRuntimeApi(api);
          const depthBefore = currentState.settlementStack.length;
          await entry.execute(api);
          // 弹栈:execute 内部 push 的帧
          while (currentState.settlementStack.length > depthBefore) {
            currentState = { ...currentState, settlementStack: currentState.settlementStack.slice(0, -1) };
          }
          // 恢复原始 execute 的 runtimeApi(让原始 execute 从 pending 恢复后能继续调用 api.apply)
          if (activeExecuteApi) {
            setRuntimeApi(activeExecuteApi);
          } else {
            setRuntimeApi(null);
          }
        }
      }
      // 消费 pending slot — 这会让原始 execute 从 await 恢复
      const resolve = slot.resolve;
      slot.resolve = () => {};
      resolve();

      // 等原始 execute 完成(它从 await 恢复后继续执行,最终完成)
      if (activeExecuteP) {
        await activeExecuteP;
      }

      // 从原始 execute 的 ctx 读取最新 state(包含 execute 的所有状态变更)
      if (activeExecuteCtx) {
        currentState = activeExecuteCtx.state;
      }

      // 弹栈:如果原始 frame 还在栈顶
      if (frame && frame === topFrame(currentState)) {
        currentState = { ...currentState, settlementStack: currentState.settlementStack.slice(0, -1) };
      }
      activeExecuteCtx = undefined;
      activeExecuteP = undefined;

      // 记录 action
      logAction(message);

      // 检查游戏结束
      const { gameOver, winner } = checkGameOver();
      return { state: currentState, gameOver, winner };
    }

    // === 主动 action 路径 ===
    let entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
    if (!entry && message.actionType === 'use') {
      const cardId = message.params?.cardId as string | undefined;
      if (cardId) {
        const card = currentState.cardMap[cardId];
        if (card?.type === '装备牌') {
          entry = findActionEntry('装备通用', message.ownerId, message.actionType);
        }
      }
    }
    if (!entry) {
      return { state: currentState };
    }

    const view = buildView(currentState, getViewerIndex(currentState, message.ownerId));
    const validationError = entry.validate(view, message.params);
    if (validationError !== null) {
      return { state: currentState, error: validationError };
    }

    // 构造 api,启动 execute
    let dispatchReadyResolve: () => void = () => {};
    const dispatchReady = new Promise<void>((r) => { dispatchReadyResolve = r; });
    let fired = false;
    const fireDispatchReady = (): void => {
      if (!fired) { fired = true; dispatchReadyResolve(); }
    };
    const { api, ctx } = makeApi(
      currentState,
      message.ownerId,
      { ...message.params, __ownerId: message.ownerId },
      fireDispatchReady,
    );
    currentState = ctx.state;
    activeExecuteCtx = ctx;
    activeExecuteApi = api;
    // 记录 execute 前的帧栈深度(技能 pushFrame 后引擎自动弹栈)
    const depthBefore = currentState.settlementStack.length;

    setRuntimeApi(api);
    const executeP = entry.execute(api)
      .finally(() => {
        setRuntimeApi(null);
        // 从 engine api 读取最新 state
        currentState = ctx.state;
        // 弹栈:execute 内部 push 的帧
        while (currentState.settlementStack.length > depthBefore) {
          currentState = { ...currentState, settlementStack: currentState.settlementStack.slice(0, -1) };
        }
        // 触发 dispatchReady(如果 execute 在没有 pending 的情况下完成)
        fireDispatchReady();
      });
    activeExecuteP = executeP;

    // 等到挂起点或完成
    if (dispatchReady) await dispatchReady;
    // 读取最新 state(可能已被 engine-api 修改,如添加 pendingSlot)
    currentState = ctx.state;

    // 记录 action
    logAction(message);

    // 检查游戏结束
    const { gameOver, winner } = checkGameOver();
    return { state: currentState, gameOver, winner };
  }

  function getState(): GameState {
    return currentState;
  }

  function resetForTest(): void {
    clearAllSkillInstances();
    clearEvents();
    currentState = createGameState({ players: [], cardMap: {} });
  }

  return { dispatch, buildView: (viewer) => buildView(currentState, viewer), resetForTest, bootstrap, getState };
}

function getViewerIndex(state: GameState, ownerName: string): number {
  return state.players.findIndex((p) => p.name === ownerName);
}

/** 兜底:补全老 state 缺失的字段 */
function ensureStateShape(state: GameState): GameState {
  if (!state.cardWrappers) state = { ...state, cardWrappers: {} };
  if (!state.atomStack) state = { ...state, atomStack: [] };
  if (!state.settlementStack) state = { ...state, settlementStack: [] };
  if (state.players.some((p) => !p.judgeZone)) {
    state = { ...state, players: state.players.map((p) => ({ ...p, judgeZone: p.judgeZone ?? [] })) };
  }
  return state;
}
