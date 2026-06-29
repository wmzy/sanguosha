// src/engine/atoms/结算帧入栈.ts
// 结算帧入栈:技能 execute 开始时压入一个新的结算帧到 state.settlementStack。
// 走 atom 管线(而非直接 mutate),保证 view.settlementStack 与后端同步。
//
// 与 pushFrame 函数的关系:pushFrame 内部 applyAtom({ type: '结算帧入栈', ... }),
// 返回被压入的 frame 引用(与旧同步签名行为一致)。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 结算帧入栈: AtomDefinition<{
  skillId: string;
  from: number;
  params?: Record<string, import('../types').Json>;
}> = {
  type: '结算帧入栈',
  validate() {
    return null;
  },
  apply(state, atom) {
    const frame = {
      skillId: atom.skillId,
      from: atom.from,
      params: { ...(atom.params ?? {}) },
      cards: [],
    };
    state.settlementStack.push(frame);
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '结算帧入栈',
      skillId: atom.skillId,
      from: atom.from,
      params: { ...(atom.params ?? {}) },
    };
    // 结算帧是公开信息:所有玩家看到相同的栈(包括 params)。
    // params 由技能负责只放公开数据(如 resolvedTargets/revealedIds/pickedBy)。
    return {
      ownerViews: new Map(),
      othersView: view,
    };
  },
  applyView(view, event) {
    view.settlementStack.push({
      skillId: event.skillId as string,
      from: event.from as number,
      params: { ...((event.params as Record<string, import('../types').Json>) ?? {}) },
      cards: [],
    });
  },
};

registerAtom(结算帧入栈);
