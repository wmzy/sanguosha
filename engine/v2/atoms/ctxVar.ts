import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';

/**
 * setCtxVar — 将值写入 SkillContext.localVars。
 * 不修改 GameState，仅作为信号 atom 由 executePlan 处理。
 */
export function register() {
  registerAtom({
    type: 'setCtxVar',
    apply(state: GameState, _atom: Atom) {
      return state;
    },
    toEvents(_state: GameState, atom: Atom): AtomEventResult {
      const a = atom as unknown as { type: 'setCtxVar'; key: string; value: Json };
      const payload: Json = { key: a.key, value: a.value };
      const server = { id: `evt_${Date.now().toString(36)}`, type: 'setCtxVar', timestamp: Date.now(), payload };
      return [server, new Map(), null] as const;
    },
  });
}
