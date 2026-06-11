// src/engine/create-engine.ts
// 引擎主入口。两种 dispatch 路径:
//
// 1) 主动 action(无 pending slot):CAS 校验 + seq++ → 创建 frame → push → execute →
//    等待 fireDispatchReady(挂起点)或 execute 完成。返回当前 state 段。
//
// 2) 回应 action(有 pending slot):merge message.params 到 topFrame.params →
//    尝试找到 action entry 并执行 → consume pending(挂起 promise resolve)→
//    让出微任务 → 若 execute 又挂起,等挂起;否则等 execute 完成 → pop frame。

import type {
  ClientMessage,
  EngineApi,
  GameState,
  GameView,
  Json,
  SettlementFrame,
  Skill,
} from './types';
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
import { popFrame, pushFrame, topFrame } from './settlement';

export interface DispatchResult {
  state: GameState;
  error?: string;
}

export interface EngineInstance {
  dispatch(state: GameState, message: ClientMessage): Promise<DispatchResult>;
  dispatchTimeout(state: GameState): Promise<GameState>;
  buildView(state: GameState, viewer: number): GameView;
  resetForTest(): void;
  bootstrap(initialState: GameState): GameState;
}

/** 占位 state,bootstrap 前不会调用 dispatch */
const UNINITIALIZED: GameState = {
  players: [],
  currentPlayerIndex: 0,
  phase: '准备',
  turn: { round: 1, phase: '准备', vars: {} },
  zones: { deck: [], discardPile: [], processing: [] },
  settlementStack: [],
  cardMap: {},
  cardWrappers: {},
  rngSeed: 0,
  marks: [],
  localVars: {},
  meta: { gameId: '', createdAt: 0 },
  seq: 0,
  startedAt: 0,
  actionLog: [],
};

export function createEngine(): EngineInstance {
  let currentState: GameState = UNINITIALIZED;

  function bootstrap(state: GameState): GameState {
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

  /**
   * 为一段 action/response 执行构造 frame + 上下文。
   * `initialParams` 来自消息 params + frame 自己初始化。
   */
  function makeFrameAndContext(
    state: GameState,
    skillId: string,
    from: string,
    initialParams: Record<string, Json>,
  ): { frame: SettlementFrame; ctx: EngineContext; api: EngineApi } {
    let dispatchReadyResolve: () => void = () => {};
    const dispatchReady = new Promise<void>((resolve) => {
      dispatchReadyResolve = resolve;
    });
    let fired = false;
    const fireDispatchReady = (): void => {
      if (!fired) {
        fired = true;
        dispatchReadyResolve();
      }
    };

    const frame: SettlementFrame = {
      skillId,
      from,
      params: { ...initialParams },
      cards: [],
      atomStack: [],
    };
    // 用 Object.assign 注入内部信号(SettlementFrame 公共类型不含这些字段)
    Object.assign(frame, { _dispatchReady: dispatchReady, _fireDispatchReady: fireDispatchReady });

    const ctx: EngineContext = {
      state,
      frame,
      fireDispatchReady,
    };
    const api = createEngineApi(ctx);
    // 存在 frame 上供回应路径复用
    Object.assign(frame, { _engineApi: api });
    return { frame, ctx, api };
  }

  async function dispatch(
    state: GameState,
    message: ClientMessage,
  ): Promise<DispatchResult> {
    // 兜底:state 可能来自序列化,补字段
    state = ensureStateShape(state);
    currentState = state;

    const frame = topFrame(state);

    // === 回应路径(已有 pending slot) ===
    if (frame?.pendingSlot) {
      const slot = frame.pendingSlot;
      const target = slot.definition.pending?.getTarget
        ? slot.definition.pending.getTarget(slot.atom)
        : '';
      if (message.ownerId !== target) {
        // 错误目标 — 静默丢弃
        return { state: currentState };
      }

      // 合并回应 params 到 frame.params
      frame.params = { ...frame.params, ...message.params, __responder: message.ownerId };

      // 尝试找到对应的 action entry(某些回应走完整 action,比如闪的 respond)
      const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
      if (entry) {
        const view = buildView(state, getViewerIndex(state, message.ownerId));
        const err = entry.validate(view, message.params);
        if (err === null) {
          // 回应 action 使用帧上已有的 engine api(由首次 dispatch 创建)
          await entry.execute(frame).catch((e) => {
            // eslint-disable-next-line no-console
            console.warn('action respond execute error:', e);
          });
        }
      }

      // 消费 pending slot — 这会让原始 execute 从 await 恢复
      const resolve = slot.resolve;
      slot.resolve = () => {}; // 防止重复 resolve
      resolve();

      // 让出微任务,等原始 execute 继续推进
      const execP = (frame as { _executePromise?: Promise<void> })._executePromise;
      if (execP) {
        await new Promise<void>((r) => setTimeout(r, 0));
        if (!frame.pendingSlot) {
          await execP.catch((e) => {
            // eslint-disable-next-line no-console
            console.warn('execute continuation error:', e);
          });
        }
      }

      // 从 frame 上的 engine api 读取最新 state(原始 execute 可能已完成并修改了 state)
      const frameApi = (frame as { _engineApi?: { state: GameState } })._engineApi;
      if (frameApi) currentState = frameApi.state;

      // 如果 frame 还在栈顶(没被 pop),pop 它(execute 已完成或等待下一轮 pending)
      if (frame === topFrame(currentState)) {
        currentState = popFrame(currentState);
      }
      return { state: currentState };
    }


    let entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
    if (!entry && message.actionType === 'use') {
      // 装备牌的 use 走"装备通用"技能
      const cardId = message.params?.cardId as string | undefined;
      if (cardId) {
        const card = currentState.cardMap[cardId];
        if (card?.type === '装备牌') {
          entry = findActionEntry('装备通用', message.ownerId, message.actionType);
        }
      }
    }
    if (!entry) {
      // 未注册的 action:静默丢弃
      return { state: currentState };
    }

    const view = buildView(currentState, getViewerIndex(currentState, message.ownerId));
    const validationError = entry.validate(view, message.params);
    if (validationError !== null) {
      return { state: currentState, error: validationError };
    }


    // 创建 frame + ctx,启动 execute
    const { frame: actionFrame, ctx, api } = makeFrameAndContext(
      currentState,
      message.skillId,
      message.ownerId,
      { ...message.params, __ownerId: message.ownerId },
    );
    currentState = pushFrame(currentState, actionFrame);
    ctx.state = currentState;

    setRuntimeApi(api);
    const executeP = entry.execute(actionFrame)
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('action execute error (background):', e);
      })
      .finally(() => {
        setRuntimeApi(null);
        // 从 engine api 读取最新 state(execute 可能通过 api.apply 修改了 ctx.state)
        currentState = ctx.state;
        const fireFn = (actionFrame as { _fireDispatchReady?: () => void })._fireDispatchReady;
        fireFn?.();
        // execute 完成:pop frame
        if (actionFrame === topFrame(currentState) && !actionFrame.pendingSlot) {
          currentState = popFrame(currentState);
        }
      });
    (actionFrame as { _executePromise?: Promise<void> })._executePromise = executeP;

    // 等到挂起点或完成
    const dispatchReady = (actionFrame as { _dispatchReady?: Promise<void> })._dispatchReady;
    if (dispatchReady) await dispatchReady;

    // 读取最新 state(可能 execute 已完成并修改了 ctx.state)
    currentState = ctx.state;
    return { state: currentState };
  }
  async function dispatchTimeout(state: GameState): Promise<GameState> {
    state = ensureStateShape(state);
    currentState = state;

    const frame = topFrame(currentState);
    if (!frame?.pendingSlot) return currentState;

    const def = frame.pendingSlot.definition;
    if (def.pending?.onTimeout) {
      // 构造 api,执行 onTimeout atom
      const { ctx, api } = makeFrameAndContext(currentState, frame.skillId, frame.from, {
        ...frame.params,
        __ownerId: frame.from,
      });
      try {
        await api.apply(def.pending.onTimeout);
        currentState = ctx.state;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('onTimeout error:', e);
      }
    }

    // 消费 pending
    const slot = frame.pendingSlot;
    const resolve = slot.resolve;
    slot.resolve = () => {};
    resolve();

    // 等 execute 继续
    const execP = (frame as { _executePromise?: Promise<void> })._executePromise;
    if (execP) {
      await new Promise<void>((r) => setTimeout(r, 0));
      if (!frame.pendingSlot) {
        await execP.catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('execute continuation error (timeout):', e);
        });
      }
    }
    if (frame === topFrame(currentState)) {
      currentState = popFrame(currentState);
    }
    return currentState;
  }

  function resetForTest(): void {
    clearAllSkillInstances();
    clearEvents();
    currentState = undefined;
  }

  return { dispatch, dispatchTimeout, buildView, resetForTest, bootstrap };
}

function getViewerIndex(state: GameState, ownerName: string): number {
  return state.players.findIndex((p) => p.name === ownerName);
}

/** 兜底:补全老 state 缺失的字段 */
function ensureStateShape(state: GameState): GameState {
  if (state.cardWrappers && state.players.every((p) => p.judgeZone)) return state;
  return {
    ...state,
    cardWrappers: state.cardWrappers ?? {},
    players: state.players.map((p) => ({ ...p, judgeZone: p.judgeZone ?? [] })),
  };
}
