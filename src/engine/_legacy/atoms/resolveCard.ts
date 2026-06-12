// @ts-nocheck
import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';

/**
 * resolveCard: 牌效果真正结算（所有目标确定后）。
 * apply 不改 state — 实际效果由 card handler 提前应用；本原子仅作为钩子点。
 * onAfter.additionalAtoms 可追加副作用（如借刀杀人/五谷/桃园 钩子就位）。
 */
export function register() {
  registerAtom({
    type: '解决',
    apply(s: GameState) { return s; },
  });
}
