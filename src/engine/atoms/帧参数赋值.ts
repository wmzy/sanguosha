// src/engine/atoms/帧参数赋值.ts
// 结算帧 params 字段赋值(走 atom,保证前端同步)。
//
// frame.params 的 mutate 不产生 ViewEvent,前端看不到。
// 需要前端感知的 params 变更(如五谷丰登的 revealedIds/pickedBy)
// 必须通过此 atom 同步。
//
// 操作栈顶帧:set params[key] = value。
import type { AtomDefinition, ViewEventSplit, ViewEvent, Json } from '../types';
import { registerAtom } from '../atom';

export const 帧参数赋值: AtomDefinition<{ key: string; value: Json }> = {
  type: '帧参数赋值',
  validate(state) {
    if (state.settlementStack.length === 0) return 'settlementStack 为空,无栈顶帧可赋值';
    return null;
  },
  apply(state, atom) {
    const frame = state.settlementStack[state.settlementStack.length - 1];
    frame.params[atom.key] = atom.value;
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '帧参数赋值',
      key: atom.key,
      value: atom.value,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(view, event) {
    const frame = view.settlementStack[view.settlementStack.length - 1];
    if (frame) {
      frame.params[event.key as string] = event.value as Json;
    }
  },
};

registerAtom(帧参数赋值);
