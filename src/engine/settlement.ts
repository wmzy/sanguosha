// src/engine/settlement.ts
// 结算区栈完整实装(ENGINE-DESIGN §6.2)
// Promise-based pending: frame.apply(等待型 atom) 返回挂起的 Promise,
// 由外部 dispatch 回应/超时调用 frame.consumePending() resolve。
// 帧生命周期:execute 启动时入栈,execute 完成后(executor.onComplete)出栈。
// 信号:
//  - _dispatchReady:execute 抵达挂起点(等待型 atom)或完成时 resolve
//    (主动 action dispatch await 它,resolve 后立即返回当前 segment state)
import type {
  Atom,
  AtomAfterContext,
  AtomBeforeContext,
  GameState,
  Json,
  NotifyEvent,
  SettlementFrame,
} from './types';
import { applyAtom, getAtomDef, resolvePlayerViews } from './atom';
import { getAfterHooks, getBeforeHooks } from './skill';

class DropAtom extends Error {
  constructor() {
    super('Atom dropped');
    this.name = 'DropAtom';
  }
}

export interface FrameExecutor {
  state: GameState;
  onComplete?: () => void;
}

function makeFrame(
  parent: SettlementFrame | undefined,
  initial: { skillId: string; from: string; params?: Record<string, Json>; cards?: string[] },
  executor: FrameExecutor,
): SettlementFrame {
  let dispatchReadyResolve: () => void = () => {};
  const dispatchReady = new Promise<void>((resolve) => {
    dispatchReadyResolve = resolve;
  });
  let dispatchReadyFired = false;
  const fireDispatchReady = (): void => {
    if (!dispatchReadyFired) {
      dispatchReadyFired = true;
      dispatchReadyResolve();
    }
  };

  const frame: SettlementFrame = {
    skillId: initial.skillId,
    from: initial.from,
    params: { ...(initial.params ?? {}) },
    cards: initial.cards ?? [],
    atomStack: [],
    parent,
    async apply(atom: Atom): Promise<void> {
      frame.atomStack.push(atom);
      const ctx: AtomBeforeContext = {
        state: executor.state,
        atom,
        self: frame.from,
        params: frame.params,
        drop: () => {
          throw new DropAtom();
        },
        modifyParams: (patch) => {
          frame.params = { ...frame.params, ...patch };
        },
        apply: async (a) => {
          await frame.apply(a);
        },
      };
      const beforeHooks = getBeforeHooks(atom.type);
      try {
        for (const h of beforeHooks) {
          ctx.self = h.ownerId;
          await h.handler(ctx);
        }
      } catch (e) {
        if (e instanceof DropAtom) {
          frame.atomStack.pop();
          return;
        }
        throw e;
      }
      frame.atomStack.pop();
      const def = getAtomDef(atom.type);
      const error = def.validate(executor.state, atom);
      if (error !== null) return;
      const after = applyAtom(executor.state, atom);
      executor.state = after;
      resolvePlayerViews(after, atom);
      if (def.pending) {
        await new Promise<void>((resolve) => {
          const timeoutMs = def.pending!.timeout ? def.pending!.timeout * 1000 : 30_000;
          frame.pendingSlot = {
            atom,
            definition: def,
            startTime: Date.now(),
            deadline: Date.now() + timeoutMs,
            resolve: () => {
              resolve();
            },
          };
          fireDispatchReady();
        });
        frame.pendingSlot = undefined;
      }
      const afterCtx: AtomAfterContext = {
        state: executor.state,
        atom,
        self: frame.from,
        params: frame.params,
        modifyParams: (patch) => {
          frame.params = { ...frame.params, ...patch };
        },
        apply: async (a) => {
          await frame.apply(a);
        },
        notify: () => {},
      };
      const afterHooks = getAfterHooks(atom.type);
      for (const h of afterHooks) {
        afterCtx.self = h.ownerId;
        await h.handler(afterCtx);
      }
    },
    consumePending() {
      if (frame.pendingSlot) {
        const r = frame.pendingSlot.resolve;
        frame.pendingSlot = undefined;
        r();
      }
    },
    drop() {
      if (frame.pendingSlot) {
        const r = frame.pendingSlot.resolve;
        frame.pendingSlot = undefined;
        r();
      }
    },
    modifyParams(patch) {
      frame.params = { ...frame.params, ...patch };
    },
    notify(_event: NotifyEvent) {},
    _executor: executor,
  };
  (frame as { _dispatchReady?: Promise<void> })._dispatchReady = dispatchReady;
  (frame as { _fireDispatchReady?: () => void })._fireDispatchReady = fireDispatchReady;
  return frame;
}

export function pushFrame(state: GameState, frame: SettlementFrame): GameState {
  return { ...state, settlementStack: [...state.settlementStack, frame] };
}

export function popFrame(state: GameState): GameState {
  if (state.settlementStack.length === 0) return state;
  return { ...state, settlementStack: state.settlementStack.slice(0, -1) };
}

export function topFrame(state: GameState): SettlementFrame | undefined {
  return state.settlementStack[state.settlementStack.length - 1];
}

export { makeFrame };
