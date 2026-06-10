// src/engine/atoms/洗牌.ts
// 洗牌:重新随机化牌堆顺序(RNG 完整实装在 PR 4+)
// 简化实现:保持原顺序(placeholder for RNG)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 洗牌: AtomDefinition<Record<string, never>> = {
  type: '洗牌',
  validate() { return null; },
  apply(state) {
    // TODO: 真正的随机化洗牌(待 RNG 接入)
    return { ...state };
  },
};

registerAtom(洗牌);
