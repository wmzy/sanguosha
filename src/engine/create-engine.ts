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
// 帧由技能在 execute 中显式创建(api.pushFrame)和弹出(api.popFrame);dispatch 不管理帧。
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

/** 从 pending atom 中提取等待目标玩家。所有内置等待型 atom 都有 target 字段 */
function extractPendingTarget(atom: import('./types').Atom): string {
  if ('target' in atom && typeof atom.target === 'string') return atom.target;
  return '';
}

export interface DispatchResult {
  state: GameState;
  error?: string;
  /** 游戏是否结束 */
  gameOver?: boolean;
  /** 获胜者名字(游戏结束时) */
  winner?: string;
}

export interface EngineInstance {
  dispatch(message: ClientMessage): Promise<DispatchResult>;
  buildView(viewer: number): GameView;
  resetForTest(): void;
  bootstrap(initialState: GameState): GameState;
  /** 重新注册当前 state 中所有玩家的技能(用于初始化游戏后) */
  rebootstrap(): void;
  /** 获取当前 state(只读) */
  getState(): GameState;
  /** 测试用:立即触发当前 pending 的 onTimeout(模拟超时,绕过真实 setTimeout) */
  fireTimeout(): Promise<DispatchResult>;
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
    // === 回应路径(已有 pending slot) ===
    if (currentState.pendingSlot) {
      const slot = currentState.pendingSlot;
      // 提取 pending atom 的 target 字段(没有 getTarget 了——每个 waiting atom 都自带 target)
      const target = extractPendingTarget(slot.atom);
      if (message.ownerId !== target) {
        return { state: currentState };
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
          await entry.execute(api);
          // 恢复原始 execute 的 runtimeApi(让原始 execute 从 pending 恢复后能继续调用 api.apply)
          if (activeExecuteApi) {
            setRuntimeApi(activeExecuteApi);
          } else {
            setRuntimeApi(null);
          }
          // 回应 action 也可能修改 state,同步到主 ctx
          if (activeExecuteCtx) {
            activeExecuteCtx.state = ctx.state;
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

      activeExecuteCtx = undefined;
      activeExecuteP = undefined;

      // 记录 action + 递增 seq
      logAction(message);
      currentState = { ...currentState, seq: currentState.seq + 1 };

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
    setRuntimeApi(api);
    const executeP = entry.execute(api)
      .finally(() => {
        setRuntimeApi(null);
        // 从 engine api 读取最新 state
        currentState = ctx.state;
        // 触发 dispatchReady(如果 execute 在没有 pending 的情况下完成)
        fireDispatchReady();
      });
    activeExecuteP = executeP;

    // 等到挂起点或完成
    if (dispatchReady) await dispatchReady;
    // 读取最新 state(可能已被 engine-api 修改,如添加 pendingSlot)
    currentState = ctx.state;

    // 记录 action + 递增 seq
    logAction(message);
    currentState = { ...currentState, seq: currentState.seq + 1 };

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

  function rebootstrap(): void {
    for (const player of currentState.players) {
      for (const skillId of player.skills) {
        instantiateSkill(skillId, player.name);
      }
    }
  }

  async function fireTimeout(): Promise<DispatchResult> {
    const slot = currentState.pendingSlot;
    if (!slot) return { state: currentState };

    await slot._fireTimeoutNow?.();
    if (activeExecuteP) await activeExecuteP;
    if (activeExecuteCtx) currentState = activeExecuteCtx.state;
    activeExecuteCtx = undefined;
    activeExecuteP = undefined;

    // seq 不递增(不是 ClientMessage)
    const { gameOver, winner } = checkGameOver();
    return { state: currentState, gameOver, winner };
  }

  return { dispatch, buildView: (viewer) => buildView(currentState, viewer), resetForTest, bootstrap, rebootstrap, getState, fireTimeout };
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
