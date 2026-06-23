// src/engine/atoms/请求回应.ts
// 请求回应:通用等待型 atom — 等待 target 玩家回应
import type { ActionPrompt, Atom, AtomDefinition, GameState, Json, ViewEventSplit, ViewEvent } from '../types';
import { TARGET_SYSTEM, TARGET_BROADCAST } from '../types';
import { registerAtom } from '../atom';

const DEFAULT_TIMEOUT_MS = 30_000;

export const 请求回应: AtomDefinition<{
  requestType: string;
  target: number;
  prompt: ActionPrompt;
  defaultChoice?: Json;
}> = {
  type: '请求回应',
  validate(state, atom) {
    // target===TARGET_SYSTEM(-1)和 target===TARGET_BROADCAST(-2)是合法的特殊值
    if (atom.target < 0) return null;
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  pending: {
    onTimeout: { type: '无操作' },
    // 弃牌询问超时:自动弃超出手牌(逆序)。其他 requestType 超时为无操作。
    onTimeoutDynamic(state, atom) {
      if (atom.requestType !== '__弃牌') return undefined;
      const target = atom.target;
      const p = state.players[target];
      if (!p || p.hand.length <= p.maxHealth) return undefined;
      const excess = p.hand.length - p.maxHealth;
      const toDiscard = p.hand.slice(-excess);
      return { type: '弃置', player: target, cardIds: toDiscard };
    },
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
    // 广播型(target=TARGET_BROADCAST,如无懈可击):所有存活玩家都可回应,
    // 故 ownerViews 无人命中(Map key=target<0 不匹配真实 viewer),
    // 将 othersView 设为带 prompt 的完整视图,让所有人都能看到回应提示。
    if (atom.target < 0) {
      return { ownerViews: new Map([[atom.target, targetView]]), othersView: targetView };
    }
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
  applyView(view, event) {
    const target = event.target as number;
    const requestType = event.requestType as string | undefined;
    const prompt = event.prompt as ActionPrompt | undefined;
    // 广播型(target=TARGET_BROADCAST,如无懈可击):所有 viewer 都设置 pending
    if (target < 0) {
      if (!prompt) return;
      view.pending = {
        type: 'awaits',
        atom: { type: '请求回应', requestType, target, prompt } as unknown as import('../types').Atom,
        prompt,
        target,
        deadline: Date.now() + DEFAULT_TIMEOUT_MS,
        totalMs: DEFAULT_TIMEOUT_MS,
      };
      return;
    }
    // target viewer:完整 pending（可操作）
    if (view.viewer === target) {
      if (!prompt) return;
      view.pending = {
        type: 'awaits',
        atom: { type: '请求回应', requestType, target, prompt } as unknown as import('../types').Atom,
        prompt,
        target,
        deadline: Date.now() + DEFAULT_TIMEOUT_MS,
        totalMs: DEFAULT_TIMEOUT_MS,
      };
    } else {
      // 其他 viewer:观察型 pending（不可操作,但 target 供视角自动跟随）
      view.pending = {
        type: 'awaits',
        atom: { type: '请求回应', requestType, target } as unknown as import('../types').Atom,
        prompt: { type: 'confirm', title: '等待回应', cancelLabel: '' },
        target,
        deadline: Date.now() + DEFAULT_TIMEOUT_MS,
        totalMs: DEFAULT_TIMEOUT_MS,
      };
    }
  },
};

registerAtom(请求回应);
