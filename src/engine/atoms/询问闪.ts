// src/engine/atoms/询问闪.ts
// 询问闪:等待型 atom — 等待 target 出闪
import type { ActionPrompt, AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../core/atom';
import { resolveTimeoutMs } from '../index';
import {
  SHORT_DELAY_MS,
  SILENT_RESPONSE_PROMPT,
  cardResponsePreResolveForTarget,
  evaluateCardResponseModeForTarget,
} from '../core/card-response-availability';

const TIMEOUT_SEC = 15;
const PROMPT: ActionPrompt = {
  type: 'useCard',
  title: '是否出闪',
  cardFilter: { filter: (c) => c.name === '闪', min: 1, max: 1 },
};

export const 询问闪: AtomDefinition<{ target: number; source: number }> = {
  type: '询问闪',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply(_state) {
    // 等待型 atom——apply 不修改 state
  },
  pending: {
    // 超时:不出闪,结算继续(父 action 检查处理区无闪牌则造成伤害)
    onTimeout: async () => {},
    prompt: PROMPT,
    timeout: TIMEOUT_SEC,
    // 卡牌回应型预检:无手牌→skip(立即,无延时);有手牌无闪→silent(短延时,不被询问);有闪→正常。
    // 若 target 有转化/转交防御技(龙胆/倾国/护驾 等)→ 正常询问(不剥夺技能)。
    preResolve: (state, atom) =>
      cardResponsePreResolveForTarget(state, '询问闪', atom.target, (c) => c.name === '闪'),
  },
  effect: { blockUntilDone: true, duration: 200 },
  toViewEvents(state, atom): ViewEventSplit {
    const mode = evaluateCardResponseModeForTarget(state, '询问闪', atom.target, (c) => c.name === '闪');
    // silent 用固定短延时(不走 timeoutScale);normal 用缩放后的正常超时;
    // skip 不设 pending(timeoutMs 不参与)。
    const timeoutMs =
      mode === 'silent' ? SHORT_DELAY_MS : resolveTimeoutMs(state, TIMEOUT_SEC);
    const base: ViewEvent = {
      type: '询问闪',
      target: atom.target,
      source: atom.source,
      timeoutMs,
      responseMode: mode,
    };
    return {
      ownerViews: new Map([[atom.target, base]]),
      othersView: base,
    };
  },
  applyView(view, event) {
    const target = event.target as number;
    const mode = (event.responseMode as 'normal' | 'silent' | 'skip' | undefined) ?? 'normal';
    // skip:target 手牌为 0(本就公开),瞬间结束,不展示任何 pending。
    if (mode === 'skip') return;
    const timeoutMs = (event.timeoutMs as number | undefined) ?? TIMEOUT_SEC * 1000;
    const atomObj = {
      type: '询问闪',
      target,
      source: event.source,
    } as unknown as import('../types').Atom;
    if (mode === 'silent') {
      // silent:target 也不被询问——给观察型 pending(与"其他人看到的"一致),仅展示短倒计时。
      view.pending = {
        type: 'awaits',
        atom: atomObj,
        prompt: SILENT_RESPONSE_PROMPT,
        target,
        responseMode: 'silent',
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
      return;
    }
    // normal:维持现状
    if (view.viewer === target) {
      view.pending = {
        type: 'awaits',
        atom: atomObj,
        prompt: PROMPT,
        target,
        responseMode: 'normal',
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    } else {
      // 其他 viewer:观察型 pending（不可操作,但 target 供视角自动跟随）
      view.pending = {
        type: 'awaits',
        atom: atomObj,
        prompt: { type: 'confirm', title: `等待出闪`, cancelLabel: '' },
        target,
        deadline: Date.now() + timeoutMs,
        totalMs: timeoutMs,
      };
    }
  },
};

registerAtom(询问闪);
