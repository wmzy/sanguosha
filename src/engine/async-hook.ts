// engine/async-hook.ts — 异步钩子核心类型（ADR 0025）
//
// v3 registerAtomHook 的异步版：onBefore / onAfter 改 async function，
// 可 await pending(...) 挂起等玩家响应。引擎调度器在 await 处冻结 dispatch，
// 等玩家响应后从 await 恢复继续执行。
//
// 关键约束（**必须**遵守）：
// 1. 钩子禁止闭包状态——所有中间状态显式存 state.localVars[hookId:key]
// 2. 钩子禁止全局副作用——副作用只能通过 HookResult.kind 表达
// 3. pending() 是唯一 await 点——不允许 await 非 pending 异步
// 4. 钩子必须 id 稳定——跨序列化 / 跨重启保持唯一
// 5. 钩子内读 state 必须在 await 之间重新取

import type { GameState, Atom, ServerEvent, Json, PendingAction } from './types';

// ════════════════════════════════════════════════════════════════════
// Hook 上下文
// ════════════════════════════════════════════════════════════════════

export interface HookCtx {
  /** 当前 game state（await pending() 之后会过期，必须重新取） */
  state: GameState;
  /** 触发此钩子的 atom */
  atom: Atom;
  /** 钩子的 self 引用（player 过滤后的当前玩家） */
  self: string;
  /** 仅 onAfter：apply 产生的 server event */
  serverEvent?: ServerEvent;
  /** 仅 resume 时：玩家响应数据 */
  resume?: ResumeData;
}

export type ResumeData =
  | { kind: 'response'; value: Json }
  | { kind: 'cancel' }
  | { kind: 'timeout' };

// ════════════════════════════════════════════════════════════════════
// Hook 结果（替代 v3 同步版的 { cancel, atom, state, redirect, additionalAtoms }）
// ════════════════════════════════════════════════════════════════════

export type HookResult =
  | { kind: 'continue' }
  | { kind: 'cancel' }
  | { kind: 'redirect'; target: string }
  | { kind: 'modifyState'; state: GameState }
  | { kind: 'additionalAtoms'; atoms: Atom[] }
  | { kind: 'pending'; def: PendingDef; tag?: Json }
  | { kind: 'pendingThen'; def: PendingDef; then: (resume: ResumeData) => Promise<HookResult | HookResult[]>; tag?: Json };

// ════════════════════════════════════════════════════════════════════
// Pending 定义
// ════════════════════════════════════════════════════════════════════

export interface PendingDef {
  /** 等待类型（与 v2 PendingAction 对齐） */
  type: '选项' | '判定' | '出牌响应' | '多步' | '弹窗';
  /** 谁需要响应 */
  player: string;
  /** 等待类型专属数据（如选项的候选项、判定的 varKey、出牌响应的合法牌） */
  data: Json;
  /** 超时毫秒（不设 = 无限等待）*/
  timeout?: number;
  /** 超时后引擎自动提交的响应（结构化 Json，可序列化） */
  onTimeout?: Json;
  /** 是否允许玩家主动取消（v2 大部分 pending 不可取消） */
  cancelable?: boolean;
  /** 多人同步等待（如投票，列表中所有人都响应才继续） */
  broadcastTo?: string[];
  /** UI 自描述（必填——pending 必须能渲染给玩家） */
  ui: PendingUIDef;
}

export interface PendingUIDef {
  /** 主标题（i18n key 或纯文本） */
  title: string;
  /** 副标题 / 描述 */
  description?: string;
  /** 选项列表（仅 type='选项'） */
  options?: Array<{
    value: Json;
    label: string;
    description?: string;
    /** 选项是否禁用（如不满足发动条件） */
    disabled?: boolean;
  }>;
}

// ════════════════════════════════════════════════════════════════════
// 钩子元数据
// ════════════════════════════════════════════════════════════════════

export interface HookMetadata {
  /** 教学引导 / 玩法说明（i18n key 或纯文本） */
  tutorial?: string;
  /** AI Bot 响应策略标识 */
  aiPolicy?: string;
  /** UI 默认超时（毫秒）——玩家无操作时的自动响应时间 */
  defaultTimeout?: number;
  /** 该钩子触发的统计分析标签（运营 / 数据采集） */
  analyticsTag?: string;
}

// ════════════════════════════════════════════════════════════════════
// 异步钩子定义
// ════════════════════════════════════════════════════════════════════

export interface AsyncHook {
  /** 稳定标识（必填）——序列化 / 日志 / 调试 / 教学 */
  id: string;
  /** 调试 / UI 描述（i18n key 或纯文本） */
  description?: string;
  /** 监听哪个 atom type（精确匹配） */
  atomType: string;
  /** 玩家过滤（self === player 才触发）。undefined = 全员 */
  player?: string;
  /** 动态启用（return false 视为未注册）——用于技能觉醒 / 翻面等 */
  filter?: (state: GameState, atom: Atom, self: string) => boolean;
  /** apply 之前：可取消 / 替换 atom / 改 state / 挂起等玩家 */
  onBefore?: (ctx: HookCtx) => Promise<HookResult> | HookResult;
  /** apply 之后：可改 state / 追加 atom / 挂起等玩家 */
  onAfter?: (ctx: HookCtx) => Promise<HookResult> | HookResult;
  /** 元数据（教学 / AI / 统计） */
  metadata?: HookMetadata;
}

// ════════════════════════════════════════════════════════════════════
// 序列化协议（持久化 / 重启恢复 / 网络传输）
// ════════════════════════════════════════════════════════════════════

export interface SerializedPending {
  /** 稳定 uuid，跨序列化保持 */
  id: string;
  /** 恢复时调哪个钩子（onBefore / onAfter / 显式 onResume） */
  hookId: string;
  /** 钩子的"恢复点"——onBefore / onAfter / 显式 onResume */
  resumePoint: 'onBefore' | 'onAfter' | 'onResume';
  /** 触发此挂起的 atom 副本（重放时作为上下文） */
  atomSnapshot: Atom;
  /** 钩子 self 引用 */
  self: string;
  /** PendingDef 完整数据 */
  def: PendingDef;
  /** 挂起时间戳（毫秒） */
  startedAt: number;
  /** 绝对 deadline（毫秒时间戳） */
  deadline: number;
  /** 钩子自定义 tag（用于多步 pending 链的步骤识别） */
  tag?: Json;
  /** onResume 钩子函数（仅持久化时不可序列化，需在恢复时按 hookId 重新解析） */
  onResumeFn?: (ctx: HookCtx) => Promise<HookResult | HookResult[]>;
}

// ════════════════════════════════════════════════════════════════════
// 异步钩子注册表
// ════════════════════════════════════════════════════════════════════

export class AsyncHookRegistry {
  private readonly hooks: AsyncHook[] = [];

  /** 注册一个异步钩子。重复 id 会抛错（确保 hookId 唯一性） */
  register(def: AsyncHook): void {
    if (this.hooks.some((h) => h.id === def.id)) {
      throw new Error(`Async hook id "${def.id}" already registered`);
    }
    this.hooks.push(def);
  }

  /** 按 id 注销 */
  unregister(id: string): void {
    const idx = this.hooks.findIndex((h) => h.id === id);
    if (idx >= 0) this.hooks.splice(idx, 1);
  }

  /** 清空所有钩子（仅测试用） */
  clear(): void {
    this.hooks.length = 0;
  }

  /** 按 id 查找（用于反序列化恢复） */
  getById(id: string): AsyncHook | undefined {
    return this.hooks.find((h) => h.id === id);
  }

  /** 读所有钩子快照 */
  getAll(): readonly AsyncHook[] {
    return this.hooks.slice();
  }

  /** 按 atomType + 玩家过滤钩子 */
  getByAtomType(atomType: string, player: string): AsyncHook[] {
    return this.hooks
      .filter((h) => h.atomType === atomType)
      .filter((h) => h.player === undefined || h.player === player);
  }
}

// ════════════════════════════════════════════════════════════════════
// Pending 状态机（state.pending 在异步钩子化后的内部表示）
// ════════════════════════════════════════════════════════════════════

/**
 * state.pending 在异步钩子化后的新形式。
 *
 * 向后兼容：v2 PendingAction 类型继续存在。async hooks 期间，state.pending 可以是
 *  v2 PendingAction（v2 技能触发的） 或 AsyncPending（v3 异步钩子触发的）。
 *  引擎根据 type 字段分发。
 */
export interface AsyncPending {
  type: '异步钩子挂起';
  id: string;
  hookId: string;
  resumePoint: 'onBefore' | 'onAfter' | 'onResume';
  atomSnapshot: Atom;
  self: string;
  def: PendingDef;
  startedAt: number;
  deadline: number;
  tag?: Json;
}

export type AnyPending = PendingAction | AsyncPending;

// ════════════════════════════════════════════════════════════════════
// 钩子内 helper 函数签名（实现见 hook-helpers.ts）
// ════════════════════════════════════════════════════════════════════

/**
 * 挂起等玩家响应。必须在 AsyncHook 的 onBefore / onAfter 内部调用。
 *
 * @example
 * ```ts
 * onAfter: async ({ state, atom, self }) => {
 *   const choice = await pending<{ value: 'health' | 'maxHealth' }>({
 *     type: '选项',
 *     player: self,
 *     data: {},
 *     ui: {
 *       title: '崩坏',
 *       options: [
 *         { value: 'health', label: '减1点体力' },
 *         { value: 'maxHealth', label: '减1点体力上限' },
 *       ],
 *     },
 *   });
 *   if (choice.kind === 'cancel' || choice.kind === 'timeout') return { kind: 'continue' };
 *   return {
 *     kind: 'additionalAtoms',
 *     atoms: [{ type: '失去体力', player: self, count: 1 }],
 *   };
 * }
 * ```
 */
export declare function pending<T = Json>(
  def: PendingDef,
  tag?: Json,
): Promise<T | ResumeData>;

/** 取消整个 atom（不 apply，不写 serverLog，不写 playerEvents） */
export declare function cancel(): HookResult;

/** 改写 atom 目标（仅对 damage / becomeTarget 生效） */
export declare function redirect(target: string): HookResult;

/** 修改 state（覆盖应用钩子的当前 state） */
export declare function modifyState(state: GameState): HookResult;

/** 追加 atom 序列（递归 apply，不再次触发钩子） */
export declare function additionalAtoms(atoms: Atom[]): HookResult;
