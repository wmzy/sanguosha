// src/engine/atoms/并行回应.ts
// 并行回应:多目标并行盲选等待型 atom。
// 与 请求回应 的区别:targets 是复数,为每个 target 创建独立 PendingSlot,
// 各 target 独立 respond、独立 resolve,互不阻塞。
// 全部 resolve 后父 applyAtom 的 Promise 才 resolve(语义等同 Promise.all)。
//
// 典型场景:拼点(双方暗盖一张牌)、选将(多人同时选)。
import type { ActionPrompt, Atom, AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { resolveTimeoutMs } from '../create-engine';
import { registerAtom } from '../atom';

const DEFAULT_TIMEOUT_SEC = 30;

export const 并行回应: AtomDefinition<{
  requestType: string;
  targets: number[];
  prompt: ActionPrompt;
  defaultChoice?: import('../types').Json;
}> = {
  type: '并行回应',
  validate(state, atom) {
    if (!Array.isArray(atom.targets) || atom.targets.length === 0) return 'targets required';
    for (const t of atom.targets) {
      if (!state.players[t]) return `target ${t} not found`;
    }
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  pending: {
    // 超时:无操作,结算继续。被拆成的各请求回应 slot 各自独立超时
    onTimeout: async () => {},
    prompt: { type: 'confirm', title: '请回应' },
    timeout: DEFAULT_TIMEOUT_SEC,
  },
  // 并行回应拆成多个单-target 请求回应 slot
  parallelSplit(atom) {
    return atom.targets.map(target => ({
      target,
      slotAtom: { ...atom, type: '请求回应' as const, target } as unknown as Atom,
    }));
  },
  effect: { blockUntilDone: true, duration: 200 },
  toViewEvents(state, atom): ViewEventSplit {
    const timeoutMs = resolveTimeoutMs(state, DEFAULT_TIMEOUT_SEC);
    // 每个 target 看到带 prompt 的请求
    const ownerViews = new Map<number, ViewEvent>();
    for (const target of atom.targets) {
      ownerViews.set(target, {
        type: '请求回应',
        requestType: atom.requestType,
        target,
        prompt: atom.prompt,
        timeoutMs,
      });
    }
    // 其他人只看到"有玩家被请求回应"
    const othersView: ViewEvent = {
      type: '请求回应',
      requestType: atom.requestType,
      target: atom.targets[0],
      timeoutMs,
    };
    return { ownerViews, othersView };
  },
  applyView(view, event) {
    const target = event.target as number;
    const requestType = event.requestType as string | undefined;
    const prompt = event.prompt as ActionPrompt | undefined;
    const timeoutMs = (event.timeoutMs as number | undefined) ?? DEFAULT_TIMEOUT_SEC * 1000;
    // target viewer:完整 pending（可操作）
    if (view.viewer === target) {
      if (!prompt) return;
      view.pending = {
        type: 'awaits',
        atom: { type: '请求回应', requestType, target, prompt } as unknown as import('../types').Atom,
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

registerAtom(并行回应);
