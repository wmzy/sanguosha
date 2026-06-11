// src/engine/settlement.ts
// 结算区栈(ENGINE-DESIGN §6.2)。
// 帧是纯数据,由技能通过 api.pushFrame 创建并压栈;execute 结束后引擎自动弹栈。
// atomStack 和 pendingSlot 是 GameState 属性(游戏状态),不是 frame 属性。

import type { GameState, SettlementFrame } from './types';

/** 把帧入栈,返回新 state */
export function pushFrame(state: GameState, frame: SettlementFrame): GameState {
  return { ...state, settlementStack: [...state.settlementStack, frame] };
}

/** 弹出栈顶帧,返回新 state */
export function popFrame(state: GameState): GameState {
  if (state.settlementStack.length === 0) return state;
  return { ...state, settlementStack: state.settlementStack.slice(0, -1) };
}

/** 取栈顶帧(只读引用) */
export function topFrame(state: GameState): SettlementFrame | undefined {
  return state.settlementStack[state.settlementStack.length - 1];
}
