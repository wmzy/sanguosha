// src/engine/create-engine.ts
// 完整实装 ENGINE-DESIGN §4 + §6:createEngine 工厂 + dispatch 路由
import type { ClientMessage, GameState, GameView, Skill } from './types';
import { buildView } from './view/buildView';
import {
  clearAllSkillInstances,
  findActionEntry,
  getSkillModule,
  makeBackendAPI,
  setSkillInstanceUnload,
} from './skill';
import { makeFrame, popFrame, pushFrame, topFrame, PendingInterrupt } from './settlement';

export interface EngineInstance {
  /**
   * 接收 ClientMessage,返回新 state。
   * 主动 action 压栈 → 路由 → execute → 弹栈。
   * CAS(baseSeq) 由调用方在 dispatch 之外做(本接口不感知 baseSeq)。
   */
  dispatch(state: GameState, message: ClientMessage): Promise<{ state: GameState; error?: string }>;
  /**
   * 服务端超时注入:把栈顶 pendingRequest 的 defaultChoice 作为玩家回应,
   * 走和正常回应相同的'entry.execute + 杀结算代执行'路径。
   * 流程:
   * 1. 找到栈顶 pending frame + pendingRequest
   * 2. 把 defaultChoice/requestType 注入 pending.params
   * 3. 标记 pendingRequest.status = 'resolved'
   * 4. 走和'回应 action'等价的代码路径(注入到 top pending 分支)
   * 如果栈顶没有等待中的请求(已被玩家回应 / 已经被其他超时清理),返回 state 不变。
   */
  dispatchTimeout(state: GameState): Promise<GameState>;
  buildView(state: GameState, viewer: number): GameView;
  /** 重置所有 skill 实例(测试隔离用) */
  resetForTest(): void;
  /** 启动时为 state 中所有玩家的所有 skill 实例化(per player) */
  bootstrap(initialState: GameState): GameState;
}

/**
 * createEngine 工厂:返回 EngineInstance。
 * 使用时先调 bootstrap(state),然后用 dispatch 处理消息。
 */
export function createEngine(): EngineInstance {
  let currentState: GameState | undefined;

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
      setSkillInstanceUnload(skillId, ownerId, unload ?? (() => {}));
    }
    return skill;
  }

  async function dispatch(state: GameState, message: ClientMessage): Promise<{ state: GameState; error?: string }> {
    if (!currentState) currentState = state;

    // ── 检查是否有 pending 回应 ──
    const pending = topFrame(state);
    if (pending?.pendingRequest?.status === 'waiting') {
      const pr = pending.pendingRequest;
      if (message.ownerId !== pr.target) return { state };

      pr.status = 'resolved';
      const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
      pending.params = { ...pending.params, ...message.params, __responder: message.ownerId };

      let nextState: GameState = state;
      if (entry) {
        const view = buildView(state, getViewerIndex(state, message.ownerId));
        const err = entry.validate(view, message.params);
        if (err !== null) {
          // 验证失败 — 不出有效回应,直接结算
        } else {
          const sharedExecutor = pending._executor ?? { state };
          const respFrame = makeFrame(pending, {
            skillId: message.skillId,
            from: message.ownerId,
            params: { ...message.params, __ownerId: message.ownerId },
            cards: [],
          }, sharedExecutor);
          nextState = pushFrame(state, respFrame);
          sharedExecutor.state = nextState;
          try {
            await entry.execute(respFrame);
          } catch (e) {
            if (e instanceof PendingInterrupt) {
              return { state: sharedExecutor.state };
            }
            nextState = popFrame(sharedExecutor.state);
            currentState = nextState;
            return { state: nextState };
          }
          nextState = popFrame(sharedExecutor.state);
        }
      }

      if (pending._continueFn) {
        try {
          await pending._continueFn();
        } catch (e) {
          console.error('[engine] _continueFn error:', e);
        }
        nextState = pending._executor?.state ?? nextState;
      }

      nextState = popFrame(nextState);
      pending.pendingRequest = undefined;
      currentState = nextState;
      return { state: nextState };
    }

    // ── 正常 dispatch(无 pending) ──
    let entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
    if (!entry && message.actionType === 'use') {
      const cardId = message.params?.cardId as string | undefined;
      if (cardId) {
        const card = state.cardMap[cardId];
        if (card?.type === '装备牌') {
          entry = findActionEntry('装备通用', message.ownerId, message.actionType);
        }
      }
    }
    if (!entry) {
      return { state };
    }

    const view = buildView(state, getViewerIndex(state, message.ownerId));
    const validationError = entry.validate(view, message.params);
    if (validationError !== null) {
      return { state, error: validationError };
    }

    const executor: { state: GameState } = { state };
    const frame = makeFrame(undefined, {
      skillId: message.skillId,
      from: message.ownerId,
      params: { ...message.params, __ownerId: message.ownerId },
      cards: [],
    }, executor);
    let nextState = pushFrame(state, frame);
    executor.state = nextState;

    try {
      await entry.execute(frame);
    } catch (e) {
      if (e instanceof PendingInterrupt) {
        currentState = executor.state;
        return { state: executor.state };
      }
      nextState = popFrame(executor.state);
      currentState = nextState;
      return { state: nextState };
    }

    nextState = popFrame(executor.state);
    currentState = nextState;
    return { state: nextState };
  }
  /**
   * 服务端超时注入:把栈顶 pendingRequest 的 defaultChoice 作为玩家回应。
   * 走和'回应 action'等价的代码路径(create-engine.ts:60-148 的'top pending'分支),
   * entry 不存在时仍然走"杀结算"代执行。
   * 没有 pendingRequest 时返回 state 不变。
   */
  async function dispatchTimeout(state: GameState): Promise<{ state: GameState; error?: string }> {
    if (!currentState) currentState = state;
    const pending = topFrame(state);
    if (!pending?.pendingRequest || pending.pendingRequest.status !== 'waiting') return { state };
    const pr = pending.pendingRequest;
    const atom = pr.atom;
    const a = atom as { type: '请求回应'; defaultChoice?: unknown; prompt?: { defaultChoice?: unknown } };
    const defaultChoice = a.defaultChoice ?? a.prompt?.defaultChoice;
    const requestType = (atom as { requestType?: string }).requestType;
    return dispatch(state, {
      skillId: '__internal/timeout',
      actionType: '__timeout__',
      ownerId: pr.target,
      params: { __timeoutChoice: defaultChoice, __timeoutRequestType: requestType },
      baseSeq: state.seq,
    });
  }


  function resetForTest(): void {
    clearAllSkillInstances();
    currentState = undefined;
  }

  return {
    dispatch,
    dispatchTimeout,
    buildView,
    resetForTest,
    bootstrap,
  };
}

function getViewerIndex(state: GameState, ownerName: string): number {
  return state.players.findIndex(p => p.name === ownerName);
}
