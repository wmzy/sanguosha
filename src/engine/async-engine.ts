// engine/async-engine.ts — AsyncHook 引擎工厂（ADR 0025）
//
// createAsyncEngine(config) 返回支持 AsyncHook 的引擎实例：
// - 持有独立 AsyncHookRegistry
// - dispatchAsync(state, action) 是 async 函数
// - 内部用 applyAtomsAsync（不用 applyAtoms），钩子可 await ctx.pending(...)
// - 钩子挂起时把 AsyncPending 转 PendingAsyncHook 存 state.pending
// - 新 action '异步钩子响应' 携带 resume，调 applyAtomsAsync 走恢复路径
//
// 与 createEngine 共存：dispatch (sync) 仍走 v3 sync 钩子 + v2 老路径；
// dispatchAsync (async) 走 AsyncHook 体系。当前阶段不替换主 dispatch。

import type {
  GameState,
  GameAction,
  EngineResult,
  PendingAsyncHook,
  Json,
} from './types';
import type { AsyncHookRegistry, AsyncPending, ResumeData } from './async-hook';
import { applyAtomsAsync } from './atom-async';

// ════════════════════════════════════════════════════════════════════
// 公开 API
// ════════════════════════════════════════════════════════════════════

export interface AsyncEngineConfig {
  /** 创建时已注册的 async hook 注册表（调用方负责填充） */
  asyncHooks: AsyncHookRegistry;
}

export interface AsyncEngineInstance {
  /**
   * 异步 dispatch。处理普通 GameAction 走 applyAtomsAsync；
   * state.pending.type === '异步钩子挂起' 时不消费 action——等 '异步钩子响应'。
   */
  dispatchAsync(state: GameState, action: GameAction): Promise<EngineResult>;

  /** 暴露 async hook 注册表（用于 clearForTest 等场景） */
  readonly asyncHooks: AsyncHookRegistry;
}

// ════════════════════════════════════════════════════════════════════
// 实现
// ════════════════════════════════════════════════════════════════════

export function createAsyncEngine(config: AsyncEngineConfig): AsyncEngineInstance {
  const { asyncHooks } = config;

  async function dispatchAsync(
    state: GameState,
    action: GameAction,
  ): Promise<EngineResult> {
    // ── 异步钩子挂起：等待玩家响应 ──
    if (state.pending?.type === '异步钩子挂起') {
      // 收到响应 action 才推进；其它 action 拒绝
      if (action.type !== '异步钩子响应') {
        return {
          state,
          events: [],
          error: `异步钩子挂起期间只接受 异步钩子响应 action，收到: ${action.type}`,
        };
      }
      const pending = state.pending;
      // pendingId 校验（防止错位响应）
      if (action.pendingId !== pending.id) {
        return {
          state,
          events: [],
          error: `异步钩子响应 pendingId 不匹配：期望 ${pending.id}，收到 ${action.pendingId}`,
        };
      }
      // 恢复钩子：调 applyAtomsAsync 重跑原 atom + 携带 resume
      const resume = action.resume as ResumeData;
      const result = await applyAtomsAsync(
        state,
        [pending.atomSnapshot],
        { asyncHooks },
        0,
        { resume },
      );
      return {
        state: withPendingFromAsyncPending(result.state, result.pending),
        events: result.events,
        playerEvents: result.playerEvents,
        error: undefined,
      };
    }

    // ── 普通 action：调 applyAtomsAsync ──
    // 简化实现：当前只支持'阶段结束' / '造成伤害' 等纯 atom action。
    // 真实引擎需要把 action 翻译为 atoms 后再调 applyAtomsAsync。
    // 本 PoC 阶段：仅支持 action.type === '阶段结束' 这类直接对应 atom 的 action。
    // 完整实现留 D-2 后续。
    const atoms = actionToAtoms(action);
    if (atoms === null) {
      return { state, events: [], error: `async engine 不支持 action: ${action.type}` };
    }
    const result = await applyAtomsAsync(state, atoms, { asyncHooks });
    return {
      state: withPendingFromAsyncPending(result.state, result.pending),
      events: result.events,
      playerEvents: result.playerEvents,
      error: undefined,
    };
  }

  return { dispatchAsync, asyncHooks };
}

// ════════════════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════════════════

/**
 * 把 AsyncPending 转 PendingAsyncHook 写入 state.pending。
 * 同时清空 state.pending（如果 result.pending 是 null）。
 */
function withPendingFromAsyncPending(
  state: GameState,
  asyncPending: AsyncPending | null,
): GameState {
  if (asyncPending === null) {
    return { ...state, pending: null };
  }
  const bridge: PendingAsyncHook = {
    type: '异步钩子挂起',
    id: asyncPending.id,
    hookId: asyncPending.hookId,
    resumePoint: asyncPending.resumePoint,
    atomSnapshot: asyncPending.atomSnapshot,
    self: asyncPending.self,
    def: asyncPending.def as unknown as Json,
    timeout: asyncPending.deadline - asyncPending.startedAt,
    deadline: asyncPending.deadline,
    onTimeout: {
      type: '异步钩子响应',
      pendingId: asyncPending.id,
      resume: { kind: 'timeout' } as unknown as Json,
    },
  };
  return { ...state, pending: bridge };
}

/**
 * 把 action 翻译为 atom 序列。
 * 当前 PoC 阶段：仅支持与 atom 1:1 对应的 action。
 */
function actionToAtoms(action: GameAction): unknown[] | null {
  switch (action.type) {
    case '阶段结束':
      return [
        { type: '阶段结束', phase: '结束', player: (action as { player: string }).player },
      ];
    default:
      return null;
  }
}
