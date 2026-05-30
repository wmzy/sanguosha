import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';
import type { PendingTrick } from '../../../shared/types';

export function register() {
  registerAtom({
    type: 'addPendingTrick',
    apply(state: GameState, atom: Atom & { type: 'addPendingTrick'; trick: PendingTrick }) {
      const player = atom.player as string;
      return updatePlayer(state, player, p => ({
        pendingTricks: [...p.pendingTricks, atom.trick],
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: 'addPendingTrick' }): AtomEventResult {
      const player = atom.player as string;
      const payload: Json = { player, trick: atom.trick as unknown as Json };
      const server = makeServerEvent('addPendingTrick', payload);
      return [server, new Map(), makePlayerEvent('addPendingTrick', payload)];
    },
  });

  registerAtom({
    type: 'removePendingTrick',
    apply(state: GameState, atom: Atom & { type: 'removePendingTrick'; index: number }) {
      const player = atom.player as string;
      return updatePlayer(state, player, p => ({
        pendingTricks: p.pendingTricks.filter((_, i) => i !== atom.index),
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: 'removePendingTrick' }): AtomEventResult {
      const player = atom.player as string;
      const payload: Json = { player, index: atom.index };
      const server = makeServerEvent('removePendingTrick', payload);
      return [server, new Map(), makePlayerEvent('removePendingTrick', payload)];
    },
  });
}
