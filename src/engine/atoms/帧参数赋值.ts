// 结算帧 params 字段赋值。默认操作栈顶,也可定位仍在栈中的父帧。
import type { AtomDefinition, Json } from '../types';

export const 帧参数赋值: AtomDefinition<{ frameIndex?: number; key: string; value: Json }> = {
  type: '帧参数赋值',
  validate(state, atom) {
    const frameIndex = atom.frameIndex ?? state.settlementStack.length - 1;
    if (!Number.isInteger(frameIndex) || !state.settlementStack[frameIndex]) {
      return `结算帧 ${frameIndex} 不存在`;
    }
    return null;
  },
  apply(state, atom) {
    const frame = state.settlementStack[atom.frameIndex ?? state.settlementStack.length - 1];
    frame.params[atom.key] = structuredClone(atom.value);
  },
  toViewEvents(state, atom) {
    return {
      ownerViews: new Map(),
      othersView: {
        type: '帧参数赋值',
        frameIndex: atom.frameIndex ?? state.settlementStack.length - 1,
        key: atom.key,
        value: structuredClone(atom.value),
      },
    };
  },
  applyView(view, event) {
    const frameIndex = (event.frameIndex as number | undefined) ?? view.settlementStack.length - 1;
    const frame = view.settlementStack[frameIndex];
    if (frame) frame.params[event.key as string] = structuredClone(event.value as Json);
  },
};
