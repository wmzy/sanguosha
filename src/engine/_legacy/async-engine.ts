// @ts-nocheck
// engine/async-engine.ts — AsyncHook 引擎工厂（ADR 0025）
//
// createAsyncEngine(config) 返回支持 AsyncHook 的引擎实例。
// 与 createEngine 互补：老 dispatch 走 v3 sync + v2 老路径；dispatchAsync 走 AsyncHook。
//
// 关键 API 形状（PoC 阶段）：
// - dispatchAsync(state, atoms): 主入口，直接传 atom 序列
// - resolveAsyncHookResponse(state, pendingId, resume): 玩家响应入口
//   （session.ts 调；不暴露 GameAction 类型耦合）
//
// state.pending 桥接：AsyncPending → PendingAsyncHook 写回 state.pending，
// dispatch 见到 PendingAsyncHook 不进入下个 action。

import type {
  GameState,
  EngineResult,
  PendingAsyncHook,
  Json,
  Atom,
  AtomLogEntry,
} from './types';
import type { AsyncHookRegistry, AsyncPending, ResumeData } from './async-hook';
import { applyAtomsAsync } from './atom-async';

// ════════════════════════════════════════════════════════════════════
// 公开 API
// ════════════════════════════════════════════════════════════════════

export interface AsyncEngineConfig {
  asyncHooks: AsyncHookRegistry;
}

export interface AsyncEngineInstance {
  /**
   * 异步 dispatch：直接接受 atom（或 atom 数组），调 applyAtomsAsync。
   * state.pending 写入 PendingAsyncHook 形态时返回。
   */
  dispatchAsync(state: GameState, atoms: Atom | Atom[]): Promise<EngineResult>;

  /**
   * 玩家响应：恢复 AsyncPending 走 applyAtomsAsync 恢复路径。
   * pendingId 不匹配返回 error（防错位响应）。
   */
  resolveAsyncHookResponse(
    state: GameState,
    pendingId: string,
    resume: ResumeData,
  ): Promise<EngineResult>;

  readonly asyncHooks: AsyncHookRegistry;
}

// ════════════════════════════════════════════════════════════════════
// 实现
// ════════════════════════════════════════════════════════════════════

export function createAsyncEngine(config: AsyncEngineConfig): AsyncEngineInstance {
  const { asyncHooks } = config;

  async function dispatchAsync(
    state: GameState,
    atoms: Atom | Atom[],
  ): Promise<EngineResult> {
    // 如果当前 state.pending 已是异步钩子挂起，dispatchAsync 不消费（保持挂起）。
    // 调用方应用先调 resolveAsyncHookResponse 走恢复路径。
    if (state.pending?.type === '异步钩子挂起') {
      const pending = state.pending;
      return {
        state,
        events: [],
        error: `当前等待异步钩子响应（pendingId=${pending.id}, hookId=${pending.hookId}）`,
      };
    }

    const atomArr = Array.isArray(atoms) ? atoms : [atoms];
    const result = await applyAtomsAsync(state, atomArr, { asyncHooks });
    return finalizeAsyncResult(result);
  }

  async function resolveAsyncHookResponse(
    state: GameState,
    pendingId: string,
    resume: ResumeData,
  ): Promise<EngineResult> {
    const pending = state.pending;
    if (!pending || pending.type !== '异步钩子挂起') {
      return { state, events: [], error: '当前 state.pending 不是异步钩子挂起' };
    }
    if (pending.id !== pendingId) {
      return {
        state,
        events: [],
        error: `pendingId 不匹配：state=${pending.id}, action=${pendingId}`,
      };
    }
    const result = await applyAtomsAsync(
      state,
      [pending.atomSnapshot],
      { asyncHooks, skipApply: pending.resumePoint === 'onAfter' },
      0,
      { resume },
    );
    return finalizeAsyncResult(result);
  }

  return { dispatchAsync, resolveAsyncHookResponse, asyncHooks };
}

// ════════════════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════════════════

function finalizeAsyncResult(result: {
  state: GameState;
  logEntries: AtomLogEntry[];
  playerViews: Map<string, Atom[]>;
  pending: AsyncPending | null;
}): EngineResult {
  let nextState = result.state;
  if (result.pending) {
    const bridge: PendingAsyncHook = {
      type: '异步钩子挂起',
      id: result.pending.id,
      hookId: result.pending.hookId,
      resumePoint: result.pending.resumePoint,
      atomSnapshot: result.pending.atomSnapshot,
      self: result.pending.self,
      def: result.pending.def as unknown as Json,
      timeout: result.pending.deadline - result.pending.startedAt,
      deadline: result.pending.deadline,
      onTimeout: {
        type: '异步钩子响应',
        pendingId: result.pending.id,
        resume: { kind: 'timeout' } as unknown as Json,
      },
    };
    nextState = { ...nextState, pending: bridge as unknown as typeof nextState.pending };
  } else {
    nextState = { ...nextState, pending: null };
  }
  return {
    state: nextState,
    logEntries: result.logEntries,
    playerViews: result.playerViews,
    error: undefined,
  };
}
