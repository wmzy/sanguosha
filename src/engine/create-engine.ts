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

    // ── 检查是否有 pending 等待 ──
    const frame = topFrame(state);
    if (frame?.pendingSlot) {
      const slot = frame.pendingSlot;
      // 检查 target 匹配
      const target = slot.definition.pending?.getTarget
        ? slot.definition.pending.getTarget(slot.atom)
        : '';
      if (message.ownerId !== target) return { state };

      // 找到匹配的 action
      const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
      frame.params = { ...frame.params, ...message.params, __responder: message.ownerId };

      let nextState: GameState = state;
      if (entry) {
        const view = buildView(state, getViewerIndex(state, message.ownerId));
        const err = entry.validate(view, message.params);
        if (err === null) {
          // action execute 在当前帧上（不压新帧）
          const executor = frame._executor ?? { state };
          try {
            await entry.execute(frame);
          } catch (e) {
            if (e instanceof PendingInterrupt) {
              currentState = executor.state;
              return { state: executor.state };
            }
            currentState = frame._executor?.state ?? state;
            return { state: currentState };
          }
          nextState = frame._executor?.state ?? state;
        }
      }

      // 如果杀的 execute 注册了续跑函数，执行它
      if (frame._continueFn) {
        try {
          await frame._continueFn();
        } catch (e) {
          // ignore
        }
      }

      // 消费 pending
      frame.consumePending();
      nextState = frame._executor?.state ?? nextState;
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
    const actionFrame = makeFrame(undefined, {
      skillId: message.skillId,
      from: message.ownerId,
      params: { ...message.params, __ownerId: message.ownerId },
      cards: [],
    }, executor);
    let nextState = pushFrame(state, actionFrame);
    executor.state = nextState;

    try {
      await entry.execute(actionFrame);
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
   * 服务端超时注入:执行 pending.onTimeout（如果有），然后 resolve Promise。
   * 没有 pendingSlot 时返回 state 不变。
   */
  async function dispatchTimeout(state: GameState): Promise<GameState> {
    if (!currentState) currentState = state;
    const frame = topFrame(state);
    if (!frame?.pendingSlot) return state;

    const slot = frame.pendingSlot;
    const def = slot.definition;

    // 执行 onTimeout atom（如果有）
    if (def.pending?.onTimeout) {
      const executor = frame._executor ?? { state };
      try {
        await frame.apply(def.pending.onTimeout);
      } catch (e) {
        // ignore
      }
      currentState = executor.state;
    }

    // 消费 pending：resolve Promise
    frame.consumePending();
    return currentState;
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
