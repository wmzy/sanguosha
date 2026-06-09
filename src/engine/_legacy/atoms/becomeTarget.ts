import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';

/**
 * becomeTarget: 目标正式确定（可被"不能成为目标"类技能拦截）。
 * apply 不改 state — 目标已被 card handler 写入 state；本原子仅作为钩子点。
 * onBefore.cancel 由空城/帷幕/谦逊使用，阻止目标确定。
 */
export function register() {
  registerAtom({
    type: '成为目标',
    apply(s: GameState) { return s; },
  });
}
