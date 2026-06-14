// src/engine/atoms/请求回应.ts
// 请求回应:通用等待型 atom — 等待 target 玩家回应
import type { ActionPrompt, AtomDefinition, Json, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 请求回应: AtomDefinition<{
  requestType: string;
  target: number;
  prompt: ActionPrompt;
  defaultChoice?: Json;
}> = {
  type: '请求回应',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  pending: {
    onTimeout: { type: '无操作' },
    prompt: { type: 'confirm', title: '请回应' },
    timeout: 30,
  },
  effect: { blockUntilDone: true, duration: 200 },
  toViewEvents(_state, atom): ViewEventSplit {
    const effect = { blockUntilDone: true as const, duration: 200 };
    // target 看到带 prompt 的请求
    const targetView: ViewEvent = {
      type: '请求回应',
      requestType: atom.requestType,
      target: atom.target,
      prompt: atom.prompt,
      effect,
    };
    // 其他人只看到"某人被请求回应"
    const othersView: ViewEvent = {
      type: '请求回应',
      requestType: atom.requestType,
      target: atom.target,
      effect: { duration: 200 },
    };
    return {
      ownerViews: new Map([[atom.target, targetView]]),
      othersView,
    };
  },
};

registerAtom(请求回应);
