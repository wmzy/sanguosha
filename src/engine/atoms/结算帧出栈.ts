// src/engine/atoms/结算帧出栈.ts
// 结算帧出栈:技能 execute 结束时弹出栈顶结算帧。
// 走 atom 管线,保证 view.settlementStack 与后端同步。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 结算帧出栈: AtomDefinition<Record<string, never>> = {
  type: '结算帧出栈',
  validate(state) {
    if (state.settlementStack.length === 0) return 'settlementStack 为空,无可弹出帧';
    return null;
  },
  apply(state) {
    state.settlementStack.pop();
  },
  toViewEvents(): ViewEventSplit {
    const view: ViewEvent = { type: '结算帧出栈' };
    return {
      ownerViews: new Map(),
      othersView: view,
    };
  },
  applyView(view) {
    view.settlementStack.pop();
  },
};

registerAtom(结算帧出栈);
