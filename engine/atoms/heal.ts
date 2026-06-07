import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';
import { updatePlayer } from '../state';

export function register() {
  registerAtom({
    type: '回复体力',
    apply(state: GameState, atom: Atom & { type: '回复体力' }): GameState {
      const target = atom.target as string;
      const amount = atom.amount as number;
      return updatePlayer(state, target, p => ({
        health: Math.min(p.health + amount, p.maxHealth),
      }));
    },
    toEvents(state: GameState, atom: Atom & { type: '回复体力' }): AtomEventResult {
      const target = atom.target as string;
      const amount = atom.amount as number;
      const source = atom.source as string | undefined;
      const payload: Json = { target, amount, ...(source ? { source } : {}) };
      const server = makeServerEvent('回复体力', payload);
      return [server, new Map(), makePlayerEvent('回复体力', payload)];
    },
  });
}
