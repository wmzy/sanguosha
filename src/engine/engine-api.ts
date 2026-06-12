// src/engine/engine-api.ts
// 引擎 API 实现 + atom apply pipeline(ENGINE-DESIGN §6.1)。
//
// 关键不变量:
//   - atomStack / pendingSlot 是 GameState 属性,不是 frame 属性
//   - 帧由技能通过 api.pushFrame/api.popFrame 自行管理;dispatch 不管理帧
//   - 钩子不允许修改 atom 参数(§4.5 原子性保证)
//   - 钩子改 state 只能通过 api.apply(嵌套);没有 drop() 机制
//   - 等待型 atom 不可被取消——必走完(响应/超时)之一

import type {
  Atom,
  AtomAfterContext,
  AtomBeforeContext,
  EngineApi,
  GameState,
  Json,
  PendingSlot,
  SettlementFrame,
} from './types';
import { applyAtom, getAtomDef, resolvePlayerViews } from './atom';
import { getAfterHooks, getBeforeHooks } from './skill';
import { pushEvent } from './event-stream';

/** apply 管线单次执行的内部上下文(由 createEngine 创建,传给 createEngineApi) */
export interface EngineContext {
  /** 当前 GameState(可写,所有修改通过新 state 替换实现) */
  state: GameState;
  /** 当前消息 params(由 dispatch 注入) */
  messageParams: Record<string, Json>;
  /** 技能 ownerId */
  self: string;
  /** 触发 _dispatchReady 的内部函数(在挂起/完成时调用) */
  fireDispatchReady: () => void;
}

export function createEngineApi(ctx: EngineContext): EngineApi {
  /** 临时过渡:drop 标志。在 before hook 中调 api.drop() 会让当前 atom 的 validate/apply 跳过。
   *  仅供 6 个防具/武器 skill 调整伤害用——新代码不应使用。 */
  let droppedCurrent = false;

  const api: EngineApi = {
    get state() {
      return ctx.state;
    },
    get self() {
      return ctx.self;
    },
    get params() {
      return ctx.messageParams as Record<string, Json>;
    },
    pushFrame(skillId: string, from: string, params?: Record<string, Json>): SettlementFrame {
      const frame: SettlementFrame = {
        skillId,
        from,
        // 原则上只读——新 skill 不要 mutate。旧 skill 仍可能 mutate(stage B 后续统一改造)。
        params: params ? { ...params } : {},
        cards: [],
      };
      ctx.state = pushFrame(ctx.state, frame);
      return frame;
    },
    popFrame(): void {
      ctx.state = popFrame(ctx.state);
    },
    topFrame(): SettlementFrame | undefined {
      return topFrame(ctx.state);
    },
    async apply(atom: Atom): Promise<void> {
      droppedCurrent = false;
      ctx.state = { ...ctx.state, atomStack: [...ctx.state.atomStack, atom] };

      // before hooks
      const beforeHooks = getBeforeHooks(atom.type);
      const frame = topFrame(ctx.state);
      const beforeCtx: AtomBeforeContext = {
        state: ctx.state,
        atom,
        self: '',
        api,
        frame: frame ?? emptyFrame(),
        params: (frame?.params ?? {}) as Record<string, Json>,
      };
      for (const h of beforeHooks) {
        if (droppedCurrent) break;
        beforeCtx.self = h.ownerId;
        beforeCtx.state = ctx.state;
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
      const curFrame = topFrame(ctx.state);
      const afterCtx: AtomAfterContext = {
        state: ctx.state,
        atom,
        self: '',
        api,
        frame: curFrame ?? emptyFrame(),
        params: (curFrame?.params ?? {}) as Record<string, Json>,
      };
      for (const h of afterHooks) {
        afterCtx.self = h.ownerId;
        afterCtx.state = ctx.state;
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
          const pending = def.pending!;
          const timeoutMs = pending.timeout * 1000;
          let resolveCalled = false;
          const safeResolve = () => {
            if (resolveCalled) return;
            resolveCalled = true;
            clearTimeout(timer);
            resolve();
          };
          const slot: PendingSlot = {
            atom,
            definition: def,
            startTime: Date.now(),
            deadline: Date.now() + timeoutMs,
            resolve: safeResolve,
          };
          // 等待替换语义:新 wait 入 slot 前,旧 slot 直接 resolve(不 fire onTimeout)
          if (ctx.state.pendingSlot) {
            ctx.state.pendingSlot.resolve();
            ctx.state = { ...ctx.state, pendingSlot: undefined };
          }
          ctx.state = { ...ctx.state, pendingSlot: slot };

          // 提取 timer 回调为可复用函数,挂到 slot._fireTimeoutNow 供测试立即触发
          const fireTimeoutNow = async (): Promise<void> => {
            // 仅当此 slot 仍是当前 slot 时才 fire(避免旧 slot 残留触发)
            if (ctx.state.pendingSlot !== slot) return;
            clearTimeout(timer);
            ctx.state = { ...ctx.state, pendingSlot: undefined };
            // 执行 onTimeout atom
            await api.apply(pending.onTimeout);
            safeResolve();
          };
          slot._fireTimeoutNow = fireTimeoutNow;

          // 引擎内部管理超时定时器(必填——onTimeout 必填)
          const timer = setTimeout(fireTimeoutNow, timeoutMs);

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

function popFrame(state: GameState): GameState {
  if (state.settlementStack.length === 0) return state;
  return { ...state, settlementStack: state.settlementStack.slice(0, -1) };
}

/** 兜底空帧(atom apply 时无帧场景——启动器/无 action execute 直接 apply 的情况) */
function emptyFrame(): SettlementFrame {
  return { skillId: '', from: '', params: Object.freeze({}), cards: [] };
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
