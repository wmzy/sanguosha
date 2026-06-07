import type { GameState, Atom, AtomEventResult } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent } from '../event';

/**
 * specifyTarget: 出牌阶段，使用者指定目标（可为多目标如方天画戟）。
 * apply 不改 state — 实际目标确定由 card handler 提前完成；本原子仅作为
 * 钩子点，通知技能"使用方已指定目标"。借刀/雌雄双股剑等技能在此监听 onAfter。
 */
export function register() {
  registerAtom({
    type: '指定目标',
    apply(s: GameState) { return s; },
    toEvents(_s, atom): AtomEventResult {
      const a = atom as Atom & { type: '指定目标' };
      const cardId = a.cardId as string;
      const source = a.source as string;
      const target = a.target as string;
      return [makeServerEvent('指定目标', { cardId, source, target }), new Map(), null];
    },
  });
}
