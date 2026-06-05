import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';

/**
 * becomeTarget: 目标正式确定（可被"不能成为目标"类技能拦截）。
 * apply 不改 state — 目标已被 card handler 写入 state；本原子仅作为钩子点。
 * onBefore.cancel 由空城/帷幕/谦逊使用，阻止目标确定。
 */
export function register() {
  registerAtom({
    type: 'becomeTarget',
    apply(s: GameState) { return s; },
    toEvents(_s, atom): AtomEventResult {
      const a = atom as Atom & { type: 'becomeTarget' };
      const cardId = a.cardId as string;
      const source = a.source as string;
      const target = a.target as string;
      return [makeServerEvent('becomeTarget', { cardId, source, target }), new Map(), null];
    },
  });
}
