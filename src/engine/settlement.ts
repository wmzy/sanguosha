// src/engine/settlement.ts
// 结算区栈完整实装(ENGINE-DESIGN §6.2)
// 主动 action 压栈、回应 action 不压栈、嵌套隔离、frame.apply(atom) 完整 pipeline
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
}

function makeFrame(
  parent: SettlementFrame | undefined,
  initial: { skillId: string; from: string; params?: Record<string, Json>; cards?: string[] },
  executor: FrameExecutor,
): SettlementFrame {
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
        drop: () => {
          throw new DropAtom();
        },
        modifyParams: (patch) => {
          frame.params = { ...frame.params, ...patch };
        },
        apply: async (a) => {
          await frame.apply(a);
        },
        notify: () => {},
      };
      const beforeHooks = getBeforeHooks(atom.type);
      try {
        for (const h of beforeHooks) {
          await h.handler(ctx);
        }
      } catch (e) {
        if (e instanceof DropAtom) {
          frame.atomStack.pop();
          return;
        }
        throw e;
      }
      if (frame.pendingRequest) {
        frame.pendingRequest.status = 'resolved';
      }
      frame.atomStack.pop();
      const def = getAtomDef(atom.type);
      const error = def.validate(executor.state, atom);
      if (error !== null) return;
      const after = applyAtom(executor.state, atom);
      executor.state = after;
      resolvePlayerViews(after, atom);
      const afterCtx: AtomAfterContext = {
        state: executor.state,
        atom,
        self: frame.from,
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
        await h.handler(afterCtx);
      }
    },
    modifyParams(patch) {
      frame.params = { ...frame.params, ...patch };
    },
    notify(_event: NotifyEvent) {},
  };
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
