// core/frame.ts — 结算帧管理。
// pushFrame/popFrame 走 applyAtom 管线保证 view 同步。
// apply.ts ↔ frame.ts ESM 循环:pushFrame/popFrame 在函数体内调用 applyAtom,
// applyAtom 在函数体内调用 topFrame/emptyFrame。运行时安全(函数调用时解析 live binding)。
import type { Atom, GameState, Json, SettlementFrame } from '../types';
import { TARGET_SYSTEM } from '../types';
import { applyAtom } from './apply';

/**
 * applyAtom 在执行 atom 的 before/after hook 时可能跨 await,期间其他结算
 * 也可能把另一帧压栈。pushFrame 不能在 await applyAtom 后再读全局栈顶——
 * 那会把子结算的帧误返回给父结算。
 *
 * 用 atom 对象作短生命周期的旁路绑定：结算帧入栈 atom 的 apply 在真正
 * push 后登记同一个 atom 对象对应的 frame，pushFrame await 完成后按原子
 * 引用取回。WeakMap 不会把函数或帧引用写进 atomHistory/视图/存档。
 */
const frameByPushAtom = new WeakMap<object, SettlementFrame>();

/** 仅由「结算帧入栈」atom 在 apply 时登记稳定帧引用。 */
export function bindPushedFrame(atom: object, frame: SettlementFrame): void {
  frameByPushAtom.set(atom, frame);
}

/** 创建帧并压入 state.settlementStack,返回帧引用。
 *
 *  走 applyAtom({ type: '结算帧入栈' }) 管线,保证 view.settlementStack 与后端同步。
 *  返回被压入的 frame 引用(由入栈 atom 的 apply 绑定,不依赖 await 后的栈顶)。
 *  变为 async(applyAtom 是 async);技能 execute 已是 async,加 await 即可。 */
export async function pushFrame(
  state: GameState,
  skillId: string,
  from: number,
  params?: Record<string, Json>,
): Promise<SettlementFrame> {
  const atom: Atom = { type: '结算帧入栈', skillId, from, params };
  await applyAtom(state, atom);
  const frame = frameByPushAtom.get(atom);
  if (!frame) throw new Error('结算帧入栈未绑定帧');
  frameByPushAtom.delete(atom);
  return frame;
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
// 闪/无懈走 runUseFlow → resolve 通过「设置帧抵消」atom 更新下层帧。
// runSettlementPhase 在「生效前」后检查此字段：cancelled → 发出被抵消 atom → 跳过 resolve。
// 无双/肉林/贯石斧等武器技在 hook 中读写此字段。

/** 取栈顶帧的 cancelled 状态。 */
export function isCancelled(state: GameState, _cardId: string, _target: number): boolean {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  return frame?.cancelled === true;
}

/** 设置仍在栈中的指定帧抵消状态,按引用绑定位置后走 atom 同步视图。 */
export async function setFrameCancelled(
  state: GameState,
  frame: SettlementFrame | undefined,
  value: boolean,
): Promise<void> {
  if (!frame || frame.cancelled === value) return;
  const frameIndex = state.settlementStack.indexOf(frame);
  if (frameIndex < 0) throw new Error('待更新的结算帧已不在栈中');
  await applyAtom(state, { type: '设置帧抵消', frameIndex, cancelled: value });
}
