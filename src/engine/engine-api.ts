// src/engine/engine-api.ts
// 引擎 API 实现 + atom apply pipeline(ENGINE-DESIGN §6.1)。
//
// 单一 apply 路径:所有 atom(普通/等待)走同一段 8 步流程,唯一区别在步骤 8 是否进 pending 区。
//
// 关键不变量:
//   - 钩子不允许修改 atom 参数(§4.5 原子性保证)
//   - 钩子改 state 只能通过 api.apply(嵌套) 或 api.drop(取消)
//   - SettlementFrame 是纯数据,execute 自己读写 frame.params(本地状态,跨 atom 共享)

import type {
  Atom,
  AtomAfterContext,
  AtomBeforeContext,
  EngineApi,
  GameState,
  NotifyEvent,
  PendingSlot,
  SettlementFrame,
} from './types';
import { applyAtom, getAtomDef, resolvePlayerViews } from './atom';
import { getAfterHooks, getBeforeHooks } from './skill';
import { pushEvent } from './event-stream';

/** before 钩子用 throw 取消当前 atom(在 api 内部被 try/catch 吞掉) */
class DropAtomSignal extends Error {
  constructor() {
    super('Atom dropped');
    this.name = 'DropAtomSignal';
  }
}

/** apply 管线单次执行的内部上下文(由 createEngine 创建,传给 createEngineApi) */
export interface EngineContext {
  state: GameState;
  /** 当前 apply 栈所在的帧(由 execute 创建,push 入栈) */
  frame: SettlementFrame;
  /** 触发 _dispatchReady 的内部函数(在挂起/完成时调用) */
  fireDispatchReady: () => void;
}

export function createEngineApi(ctx: EngineContext): EngineApi {
  // 标记:在当前 before-hook 链完成后是否要丢栈顶
  let droppedCurrent = false;

  const api: EngineApi = {
    get state() {
      return ctx.state;
    },
    async apply(atom: Atom): Promise<void> {
      droppedCurrent = false;
      ctx.frame.atomStack.push(atom);

      // before hooks
      const beforeHooks = getBeforeHooks(atom.type);
      const beforeCtx: AtomBeforeContext = {
        state: ctx.state,
        atom,
        self: '',
        api,
        params: ctx.frame.params,
      };
      try {
        for (const h of beforeHooks) {
          beforeCtx.self = h.ownerId;
          await h.handler(beforeCtx);
          if (droppedCurrent) break;
        }
      } catch (e) {
        if (e instanceof DropAtomSignal) {
          droppedCurrent = true;
        } else {
          ctx.frame.atomStack.pop();
          throw e;
        }
      }

      if (droppedCurrent) {
        ctx.frame.atomStack.pop();
        droppedCurrent = false;
        return;
      }

      // validate
      const def = getAtomDef(atom.type);
      const error = def.validate(ctx.state, atom);
      if (error !== null) {
        ctx.frame.atomStack.pop();
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
        params: ctx.frame.params,
      };
      for (const h of afterHooks) {
        afterCtx.self = h.ownerId;
        await h.handler(afterCtx);
      }

      ctx.frame.atomStack.pop();

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
              ctx.frame.pendingSlot = undefined;
              resolve();
            },
          };
          ctx.frame.pendingSlot = slot;
          // 通知 dispatch:帧已抵达挂起点,可以返回当前 state
          ctx.fireDispatchReady();
        });
      }
    },
    drop() {
      droppedCurrent = true;
    },
    notify(event: NotifyEvent) {
      pushEvent({ kind: 'notify', ...event });
    },
  };
  return api;
}

/** 判定 atom:apply 后从牌堆顶翻一张到目标玩家 judgeZone */
function moveJudgeCardToZone(state: GameState, atom: { player: string; judgeType: string }): GameState {
  if (state.zones.deck.length === 0) return state;
  const topCardId = state.zones.deck[0];
  return {
    ...state,
    zones: {
      ...state.zones,
      deck: state.zones.deck.slice(1),
    },
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
