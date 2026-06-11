// src/engine/settlement.ts
// 结算区栈(ENGINE-DESIGN §6.2)。帧是纯数据——所有 apply/drop/notify 通过 EngineApi。
//
// 帧生命周期:
//   - action dispatch 创建帧,pushFrame 入栈
//   - 帧上的 execute 通过 EngineApi.apply 推 atom;等待型 atom 抵达后由 dispatch 消费
//   - execute 全部完成后,create-engine.ts 调用 popFrame 退栈

import type { GameState, SettlementFrame } from './types';

/** 把帧入栈,返回新 state(不修改原 state) */
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
