import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { addMarkToPlayer, removeMarkFromPlayer, clearExpiredMarksByPhase } from '../mark';
import { asJson } from '../../shared/typeGuards';

export function register() {
  registerAtom({
    type: 'addMark',
    apply(state: GameState, atom: Atom & { type: 'addMark' }): GameState {
      const player = atom.player as string;
      return addMarkToPlayer(state, player, atom.mark);
    },
    toEvents(_state: GameState, atom: Atom & { type: 'addMark' }): AtomEventResult {
      const player = atom.player as string;
      const payload: Json = { player, mark: asJson(atom.mark) };
      const server = makeServerEvent('addMark', payload);
      const ownerEvent = makePlayerEvent('addMark', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });

  registerAtom({
    type: 'removeMark',
    apply(state: GameState, atom: Atom & { type: 'removeMark' }): GameState {
      const player = atom.player as string;
      return removeMarkFromPlayer(state, player, atom.markId);
    },
    toEvents(_state: GameState, atom: Atom & { type: 'removeMark' }): AtomEventResult {
      const player = atom.player as string;
      const markId = atom.markId;
      const payload: Json = { player, markId };
      const server = makeServerEvent('removeMark', payload);
      const ownerEvent = makePlayerEvent('removeMark', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });

  registerAtom({
    type: 'clearExpiredMarks',
    apply(state: GameState, atom: Atom & { type: 'clearExpiredMarks' }): GameState {
      return clearExpiredMarksByPhase(state, atom.phase);
    },
    toEvents(_state: GameState, atom: Atom & { type: 'clearExpiredMarks' }): AtomEventResult {
      const payload: Json = { phase: atom.phase };
      const server = makeServerEvent('clearExpiredMarks', payload);
      return [server, new Map(), makePlayerEvent('clearExpiredMarks', payload)];
    },
  });
}
