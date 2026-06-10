// src/engine/atoms/请求回应.ts
// 请求回应:通用等待回应(confirm/distribute/choosePlayer 等)
import type { ActionPrompt, AtomDefinition, GameState, Json } from '../types';
import { registerAtom } from '../atom';

export const 请求回应: AtomDefinition<{
  requestType: string;
  target: string;
  prompt: ActionPrompt;
  defaultChoice?: Json;
  timeout?: number;
}> = {
  type: '请求回应',
  validate(state, atom) {
    if (!state.players.find(p => p.name === atom.target)) return `target not found`;
    return null;
  },
  apply(state) { return { ...state }; },
  // 等待回应:目标来自 atom.target 字段(避免硬编码为 '');
  // 兜底 timeout 30s;各调用方在 atom 自身传 timeout 字段,
  // settlement.ts:88 优先读 def.awaits.timeout,这里给 30s 默认值。
  awaits: {
    getTarget: (atom) => (atom as { target: string }).target,
    timeout: 30,
  },
  effect: { blockUntilDone: true, duration: 200 },
};

registerAtom(请求回应);
