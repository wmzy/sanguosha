// core/frame.ts — 结算帧管理。
// pushFrame/popFrame 走 applyAtom 管线保证 view 同步。
// apply.ts ↔ frame.ts ESM 循环:pushFrame/popFrame 在函数体内调用 applyAtom,
// applyAtom 在函数体内调用 topFrame/emptyFrame。运行时安全(函数调用时解析 live binding)。
import type { GameState, Json, SettlementFrame } from '../types';
import { TARGET_SYSTEM } from '../types';
import { applyAtom } from './apply';

/** 创建帧并压入 state.settlementStack,返回帧引用。
 *
 *  走 applyAtom({ type: '结算帧入栈' }) 管线,保证 view.settlementStack 与后端同步。
 *  返回被压入的 frame 引用(从栈顶取,与入栈 atom apply 写入的是同一对象)。
 *  变为 async(applyAtom 是 async);技能 execute 已是 async,加 await 即可。 */
export async function pushFrame(
  state: GameState,
  skillId: string,
  from: number,
  params?: Record<string, Json>,
): Promise<SettlementFrame> {
  await applyAtom(state, { type: '结算帧入栈', skillId, from, params });
  // 入栈 atom 的 apply 已将帧压入栈,返回栈顶引用
  return state.settlementStack[state.settlementStack.length - 1];
}

/** 弹出栈顶帧。
 *
 *  走 applyAtom({ type: '结算帧出栈' }) 管线,保证 view.settlementStack 同步。
 *  变为 async;技能 execute 加 await。 */
export async function popFrame(state: GameState): Promise<void> {
  await applyAtom(state, { type: '结算帧出栈' });
}

/** 取栈顶帧(只读引用) */
export function topFrame(state: GameState): SettlementFrame | undefined {
  return state.settlementStack[state.settlementStack.length - 1];
}

/** 取栈顶帧的牌区(替代全局 zones.processing)。
 *  无栈时回退到 state.zones.processing(仅用于无帧上下文的兼容场景)。 */
export function frameCards(state: GameState): string[] {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  return frame ? frame.cards : state.zones.processing;
}

/** 兜底空帧 */
export function emptyFrame(): SettlementFrame {
  return { skillId: '', from: TARGET_SYSTEM, params: Object.freeze({}), cards: [], cancelled: false };
}

// ── 抵消状态（结算帧 cancelled 字段操作）──
// 闪/无懈走 runUseFlow → resolve 设下层帧(stack[length-2]).cancelled = true。
// runSettlementPhase 在「生效前」后检查此字段：cancelled → 发出被抵消 atom → 跳过 resolve。
// 无双/肉林/贯石斧等武器技在 hook 中读写此字段。

/** 取栈顶帧的 cancelled 状态。 */
export function isCancelled(state: GameState, _cardId: string, _target: number): boolean {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  return frame?.cancelled === true;
}

/** 设置栈顶帧被抵消。 */
export function setCancelled(state: GameState, _cardId: string, _target: number): void {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  if (frame) frame.cancelled = true;
}

/** 清除栈顶帧的抵消状态。 */
export function clearCancelled(state: GameState, _cardId: string, _target: number): void {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  if (frame) frame.cancelled = false;
}

/** 直接操作帧的 cancelled 字段（无歧义版，供 resolve 等）。 */
export function setFrameCancelled(frame: SettlementFrame | undefined, value: boolean): void {
  if (frame) frame.cancelled = value;
}

/** 读取帧的 cancelled 字段。 */
export function getFrameCancelled(frame: SettlementFrame | undefined): boolean {
  return frame?.cancelled === true;
}
