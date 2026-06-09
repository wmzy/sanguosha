// src/engine/settlement.ts
// 结算区栈 — 完整版含 awaits/钩子在后续 Task 完善
// 本 Task 仅建立接口,PR 4 加 Skill 时实装
import type { GameState, SettlementFrame } from './types';

export function pushFrame(state: GameState, frame: SettlementFrame): GameState {
  return { ...state, settlementStack: [...state.settlementStack, frame] };
}

export function popFrame(state: GameState): GameState {
  return { ...state, settlementStack: state.settlementStack.slice(0, -1) };
}

export function topFrame(state: GameState): SettlementFrame | undefined {
  return state.settlementStack[state.settlementStack.length - 1];
}