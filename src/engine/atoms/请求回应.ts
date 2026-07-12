// src/engine/atoms/请求回应.ts
// 请求回应:通用等待型 atom — 等待 target 玩家回应
// src/engine/atoms/请求回应.ts
// 请求回应:通用等待型 atom — 等待 target 玩家回应
import type { ActionPrompt, AtomDefinition, Json, ViewEventSplit, ViewEvent } from '../types';

import { applyAtom, resolveTimeoutMs } from '../create-engine';
import { registerAtom } from '../atom';

export const 请求回应: AtomDefinition<{
  requestType: string;
  target: number;
  prompt: ActionPrompt;
  defaultChoice?: Json;
  /** 超时秒数:覆盖 pending.timeout(无懈可击=10,默认 30) */
  timeout?: number;
  /** 无懈可击抵消目标座次(仅 requestType='无懈可击' 时存在) */
  cancelTarget?: number;
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
    // 超时处理:按 requestType 分发
    async onTimeout(state, atom) {
      // 弃牌询问超时:自动弃超出手牌(逆序)
      if (atom.requestType === '__弃牌') {
        const target = atom.target;
        const p = state.players[target];
        if (!p || p.hand.length <= p.health) return;
        const excess = p.hand.length - p.health;
        const toDiscard = p.hand.slice(-excess);
        await applyAtom(state, { type: '弃置', player: target, cardIds: toDiscard });
        return;
      }
      // 其他 requestType 超时:无操作
    },
    prompt: { type: 'confirm', title: '请回应' },
    timeout: 30,
  },
  effect: { blockUntilDone: true, duration: 200 },
  toViewEvents(state, atom): ViewEventSplit {
    // 应用房间 timeoutScale:优先 atom 自带 timeout,回退到 pending.timeout。
    // 透传 timeoutMs 给 applyView,使其 deadline/totalMs 与后端真实定时器口径一致
    // (createAndAwaitSlot 同样走 resolveTimeoutMs)。
    const timeoutSec = atom.timeout ?? 请求回应.pending!.timeout;
    const isBroadcast = atom.target < 0;
    const timeoutMs = resolveTimeoutMs(state, timeoutSec, isBroadcast);
    // target 看到带 prompt 的请求
    const targetView: ViewEvent = {
      type: '请求回应',
      requestType: atom.requestType,
      target: atom.target,
      prompt: atom.prompt,
      timeoutMs,
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
      timeoutMs,
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
    // 超时:优先 event.timeoutMs(由 toViewEvents 经 resolveTimeoutMs 计算并透传),
    // 回退到默认 30s。与后端 createAndAwaitSlot 口径一致。
    const timeoutMs = (event.timeoutMs as number | undefined) ?? 30 * 1000;
    // 广播型(target=TARGET_BROADCAST,如无懈可击):所有 viewer 都设置 pending
    if (target < 0) {
      if (!prompt) return;
      view.pending = {
        type: 'awaits',
        atom: {
          type: '请求回应',
          requestType,
          target,
          prompt,
        } as unknown as import('../types').Atom,
        prompt,
        target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
      return;
    }
    // target viewer:完整 pending（可操作）
    if (view.viewer === target) {
      if (!prompt) return;
      view.pending = {
        type: 'awaits',
        atom: {
          type: '请求回应',
          requestType,
          target,
          prompt,
        } as unknown as import('../types').Atom,
        prompt,
        target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    } else {
      // 其他 viewer:观察型 pending（不可操作,但 target 供视角自动跟随）
      view.pending = {
        type: 'awaits',
        atom: { type: '请求回应', requestType, target } as unknown as import('../types').Atom,
        prompt: { type: 'confirm', title: '等待回应', cancelLabel: '' },
        target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    }
  },
};

registerAtom(请求回应);
