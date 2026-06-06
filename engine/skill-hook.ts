// engine/skill-hook.ts — Atom 钩子 API
//
// 钩子在 applyAtoms 应用每个 atom 前后触发。新技能用此 API 替代 trigger.event
// 监听。设计原则：技能自己判断 atom 类型、自己决定拦截/替换/追加。
//
// onBefore 用途：
// - 取消（return { cancel: true }）：跳过该 atom（不调 applyAtom、不写 serverLog）
// - 替换（return { atom: NewAtom }）：用新 atom 替代
// - 修改 state（return { state: NewState }）：覆盖 state
// - 改写目标（return { redirect: newTarget }）：仅对 damage / becomeTarget 生效
//   （天香/流离/借刀等"目标转移"技能的底层机制）
// onAfter 用途：
// - 追加副作用（return { additionalAtoms: [...] }）：递归 applyAtoms
//   （用于"出牌阶段摸牌后追加一张牌"等场景）
// - 修改 state（return { state: NewState }）
//
// 设计依据：docs/decisions/0012-unified-apply-atoms.md

import type { GameState, Atom, ServerEvent } from './types';

export interface BeforeHookResult {
  cancel?: boolean;
  atom?: Atom;
  state?: GameState;
  /**
   * 改写 atom.target。仅对 damage / becomeTarget 生效（其他 atom type 忽略）。
   * 用于"目标转移"类技能（天香/流离/借刀等）的底层机制。
   */
  redirect?: string;
}

export interface AfterHookResult {
  additionalAtoms?: Atom[];
  state?: GameState;
}

export type BeforeHookFn = (ctx: {
  state: GameState;
  atom: Atom;
  self: string;
}) => BeforeHookResult | void | undefined;

export type AfterHookFn = (ctx: {
  state: GameState;
  atom: Atom;
  self: string;
  serverEvent: ServerEvent;
}) => AfterHookResult | void | undefined;

export interface AtomHookDef {
  /** 监听哪个 atom type（精确匹配） */
  atomType: string;
  /** 玩家过滤（self === player 才触发）。undefined = 全员 */
  player?: string;
  /** 优先级（同 trigger.priority）；同 atomType 下高优先级先触发 */
  priority?: number;
  /** 额外过滤条件（可选） */
  filter?: (state: GameState, atom: Atom, self: string) => boolean;
  onBefore?: BeforeHookFn;
  onAfter?: AfterHookFn;
}

const hookRegistry: AtomHookDef[] = [];

export function registerAtomHook(def: AtomHookDef): void {
  hookRegistry.push(def);
}

export function clearAtomHooks(): void {
  hookRegistry.length = 0;
}

/** 获取某 atom type 的所有钩子（按优先级降序） */
export function getAtomHooks(atomType: string): AtomHookDef[] {
  return hookRegistry
    .filter((h) => h.atomType === atomType)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/** 按 player 过滤钩子 */
export function filterHooksByPlayer(hooks: AtomHookDef[], player: string): AtomHookDef[] {
  return hooks.filter((h) => h.player === undefined || h.player === player);
}
