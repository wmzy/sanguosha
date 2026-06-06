import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';

export function register() {
  registerAtom({
    type: 'removeSkill',
    apply(state: GameState, atom: Atom & { type: 'removeSkill' }): GameState {
      const player = atom.player as string;
      const skillId = atom.skillId;
      return {
        ...state,
        triggers: state.triggers.filter(t => !(t.player === player && t.skillId === skillId)),
      };
    },
    toEvents(_state: GameState, atom: Atom & { type: 'removeSkill' }): AtomEventResult {
      const player = atom.player as string;
      const skillId = atom.skillId;
      const payload: Json = { player, skillId };
      const server = makeServerEvent('removeSkill', payload);
      return [server, new Map(), makePlayerEvent('removeSkill', payload)];
    },
  });
}
