import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';

/**
 * resolveCard: 牌效果真正结算（所有目标确定后）。
 * apply 不改 state — 实际效果由 card handler 提前应用；本原子仅作为钩子点。
 * onAfter.additionalAtoms 可追加副作用（如借刀杀人/五谷/桃园 钩子就位）。
 */
export function register() {
  registerAtom({
    type: 'resolveCard',
    apply(s: GameState) { return s; },
    toEvents(_s, atom): AtomEventResult {
      const a = atom as Atom & { type: 'resolveCard' };
      const cardId = a.cardId as string;
      const source = a.source as string;
      const target = a.target as string | undefined;
      const payload: Record<string, string> = { cardId, source };
      if (target !== undefined) payload.target = target;
      return [makeServerEvent('resolveCard', payload), new Map(), null];
    },
  });
}
