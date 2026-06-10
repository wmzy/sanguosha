// src/engine/create-engine.ts
// 完整实装 ENGINE-DESIGN §4 + §6:createEngine 工厂 + dispatch 路由
import type {
  ActionEntry,
  Atom,
  ClientMessage,
  GameState,
  GameView,
  SettlementFrame,
  Skill,
} from './types';
import { buildView } from './view/buildView';
import {
  clearAllSkillInstances,
  findActionEntry,
  getSkillModule,
  makeBackendAPI,
  setSkillInstanceUnload,
} from './skill';
import { makeFrame, popFrame, pushFrame, topFrame } from './settlement';

export interface EngineInstance {
  /**
   * 接收 ClientMessage,返回新 state。
   * 主动 action 压栈 → 路由 → execute → 弹栈。
   * CAS(baseSeq) 由调用方在 dispatch 之外做(本接口不感知 baseSeq)。
   */
  dispatch(state: GameState, message: ClientMessage): Promise<GameState>;
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
    // 遍历所有玩家的所有 skill,实例化并注册
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

  async function dispatch(state: GameState, message: ClientMessage): Promise<GameState> {
    if (!currentState) currentState = state;

    // 1. 主动 action 压栈(回应 action 由 settlement.apply 内部处理)
    // 当前实现: 假设 message 总是主动 action(回应通过 frame.apply 内部走)
    // 路由查找
    const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
    if (!entry) {
      // 没找到 — 静默忽略
      return state;
    }

    // 2. 校验(GameView)
    const view = buildView(state, getViewerIndex(state, message.ownerId));
    const validationError = entry.validate(view, message.params);
    if (validationError !== null) {
      // 静默丢弃(不记入 action log)
      return state;
    }

    // 3. 构造 frame 并压栈
    const executor: { state: GameState } = { state };
    const frame = makeFrame(undefined, {
      skillId: message.skillId,
      from: message.ownerId,
      params: { ...message.params, __ownerId: message.ownerId },
      cards: [],
    }, executor);
    let nextState = pushFrame(state, frame);

    // 4. execute
    try {
      await entry.execute(frame);
    } catch (e) {
      // execute 失败 — 弹栈,返回原 state
      nextState = popFrame(executor.state);
      return nextState;
    }

    // 5. 弹栈
    nextState = popFrame(executor.state);
    currentState = nextState;
    return nextState;
  }

  function resetForTest(): void {
    clearAllSkillInstances();
    currentState = undefined;
  }

  return {
    dispatch,
    buildView,
    resetForTest,
    bootstrap,
  };
}

function getViewerIndex(state: GameState, ownerName: string): number {
  return state.players.findIndex(p => p.name === ownerName);
}
