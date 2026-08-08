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
