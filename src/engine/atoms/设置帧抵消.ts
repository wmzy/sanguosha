// 设置指定结算帧的抵消状态。响应牌须定位下层帧,不能隐式修改栈顶。
import type { AtomDefinition } from '../types';
import { broadcast } from './_helpers';

export const 设置帧抵消: AtomDefinition<{ frameIndex: number; cancelled: boolean }> = {
  type: '设置帧抵消',
  validate(state, atom) {
    if (!Number.isInteger(atom.frameIndex) || !state.settlementStack[atom.frameIndex]) {
      return `结算帧 ${atom.frameIndex} 不存在`;
    }
    return null;
  },
  apply(state, atom) {
    state.settlementStack[atom.frameIndex].cancelled = atom.cancelled;
  },
  toViewEvents(_state, atom) {
    return broadcast({
      type: '设置帧抵消',
      frameIndex: atom.frameIndex,
      cancelled: atom.cancelled,
    });
  },
  applyView(view, event) {
    const frame = view.settlementStack[event.frameIndex as number];
    if (frame) frame.cancelled = event.cancelled as boolean;
  },
};
