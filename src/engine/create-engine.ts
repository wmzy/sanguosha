// src/engine/create-engine.ts
// Promise-based dispatch:
//  - 主动 action: 启动 execute,await _dispatchReady(挂起点或完成)。
//  - 回应 action: consumePending → setTimeout(0) 让出微任务 → 判断是否需等 executeP。
import type { ClientMessage, GameState, GameView, Skill } from './types';
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
  dispatch(state: GameState, message: ClientMessage): Promise<{ state: GameState; error?: string }>;
  dispatchTimeout(state: GameState): Promise<GameState>;
  buildView(state: GameState, viewer: number): GameView;
  resetForTest(): void;
  bootstrap(initialState: GameState): GameState;
}

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

    const frame = topFrame(state);
    if (frame?.pendingSlot) {
      const slot = frame.pendingSlot;
      const target = slot.definition.pending?.getTarget
        ? slot.definition.pending.getTarget(slot.atom)
        : '';
      if (message.ownerId !== target) return { state };

      frame.params = { ...frame.params, ...message.params, __responder: message.ownerId };

      const entry = findActionEntry(message.skillId, message.ownerId, message.actionType);
      if (entry) {
        const view = buildView(state, getViewerIndex(state, message.ownerId));
        const err = entry.validate(view, message.params);
        if (err === null) {
          await entry.execute(frame).catch((e) => {
            // eslint-disable-next-line no-console
            console.warn('action respond execute error:', e);
          });
        }
      }

      frame.consumePending();
      const executeP = (frame as { _executePromise?: Promise<void> })._executePromise;
      if (executeP) {
        await new Promise<void>((r) => setTimeout(r, 0));
        if (!frame.pendingSlot) {
          await executeP.catch((e) => {
            // eslint-disable-next-line no-console
            console.warn('execute continuation error:', e);
          });
        }
      }
      const nextState = frame._executor?.state ?? state;
      currentState = nextState;
      return { state: nextState };
    }

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

    const executor: { state: GameState; onComplete?: () => void } = { state };
    const actionFrame = makeFrame(undefined, {
      skillId: message.skillId,
      from: message.ownerId,
      params: { ...message.params, __ownerId: message.ownerId },
      cards: [],
    }, executor);
    let nextState = pushFrame(state, actionFrame);
    executor.state = nextState;
    executor.onComplete = () => {
      executor.state = popFrame(executor.state);
      currentState = executor.state;
    };

    const executeP = entry.execute(actionFrame)
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('action execute error (background):', e);
      })
      .finally(() => {
        const f = actionFrame as { _fireDispatchReady?: () => void };
        f._fireDispatchReady?.();
        if (actionFrame === topFrame(executor.state)) {
          executor.onComplete?.();
        }
      });
    (actionFrame as { _executePromise?: Promise<void> })._executePromise = executeP;

    await (actionFrame as { _dispatchReady?: Promise<void> })._dispatchReady;
    currentState = executor.state;
    return { state: executor.state };
  }

  async function dispatchTimeout(state: GameState): Promise<GameState> {
    if (!currentState) currentState = state;
    const frame = topFrame(state);
    if (!frame?.pendingSlot) return state;

    const def = frame.pendingSlot.definition;
    if (def.pending?.onTimeout) {
      try {
        await frame.apply(def.pending.onTimeout);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('onTimeout error:', e);
      }
    }

    frame.consumePending();
    const executeP = (frame as { _executePromise?: Promise<void> })._executePromise;
    if (executeP) {
      await new Promise<void>((r) => setTimeout(r, 0));
      if (!frame.pendingSlot) {
        await executeP.catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('execute continuation error (timeout):', e);
        });
      }
    }
    return frame._executor?.state ?? currentState;
  }

  function resetForTest(): void {
    clearAllSkillInstances();
    currentState = undefined;
  }

  return { dispatch, dispatchTimeout, buildView, resetForTest, bootstrap };
}

function getViewerIndex(state: GameState, ownerName: string): number {
  return state.players.findIndex(p => p.name === ownerName);
}
