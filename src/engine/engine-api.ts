// src/engine/engine-api.ts
// 引擎 API 实现 + atom apply pipeline(ENGINE-DESIGN §6.1)。
//
// 关键不变量:
//   - atomStack / pendingSlot 是 GameState 属性,不是 frame 属性
//   - 帧由技能通过 api.pushFrame 创建;execute 结束后引擎自动弹栈
//   - 钩子不允许修改 atom 参数(§4.5 原子性保证)
//   - 钩子改 state 只能通过 api.apply(嵌套) 或 api.drop(取消)
//   - 引擎内部不 try/catch——除 bug 外不应抛错;DropAtomSignal 是控制流信号

import type {
  Atom,
  AtomAfterContext,
  AtomBeforeContext,
  EngineApi,
  GameState,
  PendingSlot,
  SettlementFrame,
} from './types';
import { applyAtom, getAtomDef, resolvePlayerViews } from './atom';
import { getAfterHooks, getBeforeHooks } from './skill';
import { pushEvent } from './event-stream';

/** before 钩子用 throw 取消当前 atom(控制流信号,不是错误) */
export class DropAtomSignal extends Error {
  constructor() {
    super('Atom dropped');
    this.name = 'DropAtomSignal';
  }
}

/** apply 管线单次执行的内部上下文(由 createEngine 创建,传给 createEngineApi) */
export interface EngineContext {
  /** 当前 GameState(可写,所有修改通过新 state 替换实现) */
  state: GameState;
  /** 当前消息 params(由 dispatch 注入) */
  messageParams: Record<string, import('./types').Json>;
  /** 技能 ownerId */
  self: string;
  /** 触发 _dispatchReady 的内部函数(在挂起/完成时调用) */
  fireDispatchReady: () => void;
}

export function createEngineApi(ctx: EngineContext): EngineApi {
  let droppedCurrent = false;

  const api: EngineApi = {
    get state() {
      return ctx.state;
    },
    get self() {
      return ctx.self;
    },
    get params() {
      return ctx.messageParams as Record<string, import('./types').Json>;
    },
    pushFrame(skillId: string, from: string, params?: Record<string, import('./types').Json>): SettlementFrame {
      const frame: SettlementFrame = {
        skillId,
        from,
        params: params ? { ...params } : {},
        cards: [],
      };
      ctx.state = pushFrame(ctx.state, frame);
      return frame;
    },
    topFrame(): SettlementFrame | undefined {
      return topFrame(ctx.state);
    },
    async apply(atom: Atom): Promise<void> {
      droppedCurrent = false;
      ctx.state = { ...ctx.state, atomStack: [...ctx.state.atomStack, atom] };

      // before hooks
      const beforeHooks = getBeforeHooks(atom.type);
      const beforeCtx: AtomBeforeContext = {
        state: ctx.state,
        atom,
        self: '',
        api,
        params: (topFrame(ctx.state)?.params ?? {}) as Record<string, import('./types').Json>,
      };
      for (const h of beforeHooks) {
        if (droppedCurrent) break;
        beforeCtx.self = h.ownerId;
        await h.handler(beforeCtx);
      }

      if (droppedCurrent) {
        ctx.state = { ...ctx.state, atomStack: ctx.state.atomStack.slice(0, -1) };
        droppedCurrent = false;
        return;
      }

      // validate
      const def = getAtomDef(atom.type);
      const error = def.validate(ctx.state, atom);
      if (error !== null) {
        ctx.state = { ...ctx.state, atomStack: ctx.state.atomStack.slice(0, -1) };
        return;
      }

      // apply(纯函数,新 state)
      ctx.state = applyAtom(ctx.state, atom);

      // emit atom event
      const views = resolvePlayerViews(ctx.state, atom);
      pushEvent({ kind: 'atom', atom, views });

      // 判定 atom 特殊:apply 阶段把牌堆顶牌移入目标玩家 judgeZone
      if (atom.type === '判定') {
        ctx.state = moveJudgeCardToZone(ctx.state, atom);
      }

      // after hooks
      const afterHooks = getAfterHooks(atom.type);
      const afterCtx: AtomAfterContext = {
        state: ctx.state,
        atom,
        self: '',
        api,
        params: (topFrame(ctx.state)?.params ?? {}) as Record<string, import('./types').Json>,
      };
      for (const h of afterHooks) {
        afterCtx.self = h.ownerId;
        await h.handler(afterCtx);
      }

      // 弹栈
      ctx.state = { ...ctx.state, atomStack: ctx.state.atomStack.slice(0, -1) };

      // 判定 atom 收尾:把目标 judgeZone 顶部牌移入弃牌堆
      if (atom.type === '判定') {
        ctx.state = cleanupJudgeZone(ctx.state, atom);
      }

      // pending?
      if (def.pending) {
        await new Promise<void>((resolve) => {
          const timeoutMs = def.pending!.timeout ?? 30;
          const slot: PendingSlot = {
            atom,
            definition: def,
            startTime: Date.now(),
            deadline: Date.now() + timeoutMs * 1000,
            resolve: () => {
              ctx.state = { ...ctx.state, pendingSlot: undefined };
              resolve();
            },
          };
          ctx.state = { ...ctx.state, pendingSlot: slot };
          // 通知 dispatch:帧已抵达挂起点,可以返回当前 state
          ctx.fireDispatchReady();
        });
      }
    },
    drop() {
      droppedCurrent = true;
    },
    notify(event) {
      pushEvent({ kind: 'notify', ...event });
    },
  };
  return api;
}

/** 取栈顶帧(从 state.settlementStack) */
function topFrame(state: GameState): SettlementFrame | undefined {
  return state.settlementStack[state.settlementStack.length - 1];
}

function pushFrame(state: GameState, frame: SettlementFrame): GameState {
  return { ...state, settlementStack: [...state.settlementStack, frame] };
}

/** 判定 atom:apply 后从牌堆顶翻一张到目标玩家 judgeZone */
function moveJudgeCardToZone(state: GameState, atom: { player: string; judgeType: string }): GameState {
  if (state.zones.deck.length === 0) return state;
  const topCardId = state.zones.deck[0];
  return {
    ...state,
    zones: { ...state.zones, deck: state.zones.deck.slice(1) },
    players: state.players.map((p) =>
      p.name === atom.player ? { ...p, judgeZone: [...p.judgeZone, topCardId] } : p,
    ),
  };
}

/** 判定 atom 收尾:after 链跑完后,把目标 judgeZone 顶部牌移入弃牌堆 */
function cleanupJudgeZone(state: GameState, atom: { player: string; judgeType: string }): GameState {
  const target = state.players.find((p) => p.name === atom.player);
  if (!target || target.judgeZone.length === 0) return state;
  const topId = target.judgeZone[target.judgeZone.length - 1];
  return {
    ...state,
    zones: { ...state.zones, discardPile: [...state.zones.discardPile, topId] },
    players: state.players.map((p) =>
      p.name === atom.player ? { ...p, judgeZone: p.judgeZone.slice(0, -1) } : p,
    ),
  };
}
