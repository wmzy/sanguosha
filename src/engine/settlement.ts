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

export class PendingInterrupt extends Error {
  constructor() {
    super('Pending response');
    this.name = 'PendingInterrupt';
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
        notify: () => {},
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
      // 检查 awaits:如果有,设置 pendingRequest 并暂停执行
      if (def.awaits) {
        const target = def.awaits.getTarget
          ? def.awaits.getTarget(atom)
          : def.awaits.target ?? '';
        frame.pendingRequest = {
          atom,
          target,
          status: 'waiting',
          deadline: def.awaits.timeout
            ? Date.now() + def.awaits.timeout * 1000
            : Date.now() + 30_000,
        };
        throw new PendingInterrupt();
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
    /**
     * applyOrAwait:不抛 PendingInterrupt,返回 boolean。
     * true:有 awaits,已 await 玩家回应,execute 可继续跑后续代码。
     * false:无 awaits,atom 已 apply 完成。
     * 用于 P0-5:杀.execute 末尾追加'造成伤害'/'弃牌',让 onAtomAfter('造成伤害') 钩子真正触发。
     */
    async applyOrAwait(atom: Atom): Promise<boolean> {
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
          await frame.applyOrAwait(a);
        },
        notify: () => {},
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
          return false;
        }
        throw e;
      }
      if (frame.pendingRequest) {
        frame.pendingRequest.status = 'resolved';
      }
      frame.atomStack.pop();
      const def = getAtomDef(atom.type);
      const error = def.validate(executor.state, atom);
      if (error !== null) return false;
      const after = applyAtom(executor.state, atom);
      executor.state = after;
      resolvePlayerViews(after, atom);
      if (def.awaits) {
        const target = def.awaits.getTarget
          ? def.awaits.getTarget(atom)
          : def.awaits.target ?? '';
        frame.pendingRequest = {
          atom,
          target,
          status: 'waiting',
          deadline: def.awaits.timeout
            ? Date.now() + def.awaits.timeout * 1000
            : Date.now() + 30_000,
        };
        await new Promise<void>((resolve) => {
          frame._resume = () => {
            frame._resume = undefined;
            resolve();
          };
        });
        frame.pendingRequest = undefined;
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
          await frame.applyOrAwait(a);
        },
        notify: () => {},
      };
      const afterHooks = getAfterHooks(atom.type);
      for (const h of afterHooks) {
        afterCtx.self = h.ownerId;
        await h.handler(afterCtx);
      }
      return true;
    },
    /**
     * 内部字段:applyOrAwait 在 await 玩家回应期间保存 resume 函数,
     * 外部 dispatch 收到回应时调 frame._resume?.() 唤醒 applyOrAwait。
     */
    _resume: undefined as undefined | (() => void),
    /** 内部:保存 executor 引用,供 dispatch 创建 respFrame 时复用 */
    _executor: executor,
    drop() {
      // 取消当前帧的等待回应。提醒:此方法只清 pendingRequest,不影响 frame.params;
      // 闪.execute 仍需 modifyParams({ settlement: [{...dodged: true}] }) 把结果传父帧。
      if (frame.pendingRequest) {
        frame.pendingRequest.status = 'resolved';
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
