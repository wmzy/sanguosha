// src/engine/atoms/重洗.ts
// 重洗:弃牌堆重新洗入牌堆(TODO: PR 4+ 实装)
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

export const 重洗: AtomDefinition<Record<string, never>> = {
  type: '重洗',
  validate() { return null; },
  apply(_state) {
    // TODO: 弃牌堆+牌堆合并并洗牌(待 RNG 接入)
  },
};

registerAtom(重洗);
