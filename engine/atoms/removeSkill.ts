import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';

export function register() {
  registerAtom({
    type: '去技能',
    apply(state: GameState, atom: Atom & { type: '去技能' }): GameState {
      const player = atom.player as string;
      const skillId = atom.skillId;
      return {
        ...state,
        triggers: state.triggers.filter(t => !(t.player === player && t.skillId === skillId)),
      };
    },
    toEvents(_state: GameState, atom: Atom & { type: '去技能' }): AtomEventResult {
      const player = atom.player as string;
      const skillId = atom.skillId;
      const payload: Json = { player, skillId };
      const server = makeServerEvent('去技能', payload);
      return [server, new Map(), makePlayerEvent('去技能', payload)];
    },
  });
}
