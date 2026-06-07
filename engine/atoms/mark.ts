import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { addMarkToPlayer, removeMarkFromPlayer, clearExpiredMarksByPhase } from '../mark';
import { asJson } from '../../shared/typeGuards';

export function register() {
  registerAtom({
    type: '加标记',
    apply(state: GameState, atom: Atom & { type: '加标记' }): GameState {
      const player = atom.player as string;
      return addMarkToPlayer(state, player, atom.mark);
    },
    toEvents(_state: GameState, atom: Atom & { type: '加标记' }): AtomEventResult {
      const player = atom.player as string;
      const payload: Json = { player, mark: asJson(atom.mark) };
      const server = makeServerEvent('加标记', payload);
      const ownerEvent = makePlayerEvent('加标记', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });

  registerAtom({
    type: '去标记',
    apply(state: GameState, atom: Atom & { type: '去标记' }): GameState {
      const player = atom.player as string;
      return removeMarkFromPlayer(state, player, atom.markId);
    },
    toEvents(_state: GameState, atom: Atom & { type: '去标记' }): AtomEventResult {
      const player = atom.player as string;
      const markId = atom.markId;
      const payload: Json = { player, markId };
      const server = makeServerEvent('去标记', payload);
      const ownerEvent = makePlayerEvent('去标记', payload);
      return [server, new Map([[player, ownerEvent]]), null];
    },
  });

  registerAtom({
    type: '清过期标记',
    apply(state: GameState, atom: Atom & { type: '清过期标记' }): GameState {
      return clearExpiredMarksByPhase(state, atom.phase);
    },
    toEvents(_state: GameState, atom: Atom & { type: '清过期标记' }): AtomEventResult {
      const payload: Json = { phase: atom.phase };
      const server = makeServerEvent('清过期标记', payload);
      return [server, new Map(), makePlayerEvent('清过期标记', payload)];
    },
  });
}
