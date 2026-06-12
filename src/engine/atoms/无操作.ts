// src/engine/atoms/无操作.ts
// 无操作:空 apply atom,用于"onTimeout 不需要做事"的占位场景
// (如询问闪超时不做事,继续结算)
import type { AtomDefinition, GameState } from '../types';
import { registerAtom } from '../atom';

export const 无操作: AtomDefinition<Record<string, never>> = {
  type: '无操作',
  validate() { return null; },
  apply(state: GameState): GameState { return state; },
};

registerAtom(无操作);
