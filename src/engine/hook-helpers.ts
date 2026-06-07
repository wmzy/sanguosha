// engine/hook-helpers.ts — 异步钩子内 helper 实现
//
// 这些函数是 AsyncHook.onBefore / onAfter 内部的"领域概念命名"。
// 引擎 applyAtoms 在执行钩子时设置 currentHookContext，钩子调用
// pending() / cancel() / redirect() 等 helper 实际访问该 context。
//
// 实施细节（v3 异步化的第 2-3 周）：
// - currentHookContext: AsyncHookContext | null
// - pending() 抛 PendingRequestError（内部信号），applyAtoms 捕获后挂起
// - cancel() / redirect() / additionalAtoms() 返回 HookResult

import type { GameState, Atom, ServerEvent, Json } from './types';
import type { HookResult, PendingDef, ResumeData } from './async-hook';

// ════════════════════════════════════════════════════════════════════
// 钩子执行上下文（引擎维护，钩子不直接构造）
// ════════════════════════════════════════════════════════════════════

export interface AsyncHookContext {
  /** 当前 GameState（await 之间会过期，helper 重新取） */
  state: GameState;
  /** 触发钩子的 atom */
  atom: Atom;
  /** 钩子 self */
  self: string;
  /** 钩子 id（用于 localVars namespace） */
  hookId: string;
  /** apply 后的 server event（仅 onAfter 阶段） */
  serverEvent?: ServerEvent;
  /** 当前是否在 await（如果 true，pending() 实际挂起） */
  awaiting: boolean;
}

/** 当前正在执行的钩子上下文（applyAtoms 设置，钩子 helper 读取） */
let currentHookContext: AsyncHookContext | null = null;

/** 内部信号：pending() 抛此异常以通知 applyAtoms 挂起 */
export class PendingRequestSignal extends Error {
  constructor(public readonly def: PendingDef, public readonly tag?: Json) {
    super(`pending: ${def.ui.title}`);
    this.name = 'PendingRequestSignal';
  }
}

export function setCurrentHookContext(ctx: AsyncHookContext | null): void {
  currentHookContext = ctx;
}

export function getCurrentHookContext(): AsyncHookContext | null {
  return currentHookContext;
}

// ════════════════════════════════════════════════════════════════════
// 钩子内 helper 函数
// ════════════════════════════════════════════════════════════════════

/**
 * 挂起等玩家响应。必须在 AsyncHook.onBefore / onAfter 内部调用。
 *
 * 实施：
 * - 第一次调用：抛 PendingRequestSignal，applyAtoms 捕获后挂 dispatch
 * - 玩家响应后，applyAtoms 重新执行钩子直到遇到 pending() 调用
 * - pending() 直接返回 Promise.resolve(resumeData)
 *
 * 测试：mock pending() 接受一个 (def) => Promise<ResumeData> 注入响应
 */
export async function pending<T = Json>(
  def: PendingDef,
  tag?: Json,
): Promise<T | ResumeData> {
  if (!currentHookContext) {
    throw new Error('pending() called outside AsyncHook context');
  }
  if (currentHookContext.awaiting) {
    // 第二次进入：返回玩家响应
    return currentHookContext.state.localVars?.['__resume__'] as T | ResumeData;
  }
  // 第一次进入：抛信号让 applyAtoms 挂起
  throw new PendingRequestSignal(def, tag);
}

/** 取消整个 atom */
export function cancel(): HookResult {
  return { kind: 'cancel' };
}

/** 改写 atom 目标（仅对 damage / becomeTarget 生效） */
export function redirect(target: string): HookResult {
  return { kind: 'redirect', target };
}

/** 覆盖应用钩子的当前 state */
export function modifyState(state: GameState): HookResult {
  return { kind: 'modifyState', state };
}

/** 追加 atom 序列（递归 apply，不再次触发钩子） */
export function additionalAtoms(atoms: Atom[]): HookResult {
  if (atoms.length === 0) return { kind: 'continue' };
  return { kind: 'additionalAtoms', atoms };
}

// ════════════════════════════════════════════════════════════════════
// localVars namespace helper（钩子私有状态）
// ════════════════════════════════════════════════════════════════════

/**
 * 给当前钩子的私有 state 写入一个值。
 * key 自动加 hookId 前缀（避免钩子间 key 冲突）。
 *
 * 序列化时整段 localVars 一起进 serverLog——重启后完整恢复。
 */
export function setLocalVar(key: string, value: Json): void {
  if (!currentHookContext) {
    throw new Error('setLocalVar() called outside AsyncHook context');
  }
  const ns = `${currentHookContext.hookId}:${key}`;
  currentHookContext.state = {
    ...currentHookContext.state,
    localVars: {
      ...(currentHookContext.state.localVars ?? {}),
      [ns]: value,
    },
  };
}

/** 读当前钩子的私有 state 值 */
export function getLocalVar<T = Json>(key: string): T | undefined {
  if (!currentHookContext) return undefined;
  const ns = `${currentHookContext.hookId}:${key}`;
  return currentHookContext.state.localVars?.[ns] as T | undefined;
}
