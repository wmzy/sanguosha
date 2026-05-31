import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';

export function register() {
  registerAtom({
    type: 'setPhase',
    apply(state: GameState, atom: Atom & { type: 'setPhase' }) {
      return { ...state, phase: atom.phase };
    },
    toEvents(state: GameState, atom: Atom & { type: 'setPhase' }): AtomEventResult {
      const payload: Json = { phase: atom.phase, player: state.currentPlayer };
      const server = makeServerEvent('setPhase', payload);
      return [server, new Map(), makePlayerEvent('setPhase', payload)];
    },
  });

  registerAtom({
    type: 'nextPlayer',
    apply(state: GameState, _atom: Atom & { type: 'nextPlayer' }) {
      const alive = state.playerOrder.filter(name => state.players[name].info.alive);
      if (alive.length === 0) return state;
      const currentIdx = alive.indexOf(state.currentPlayer);
      const nextIdx = (Math.max(0, currentIdx) + 1) % alive.length;
      const nextPlayer = alive[nextIdx];
      const wrappedAround = currentIdx === -1 || nextIdx <= currentIdx;
      return {
        ...state,
        currentPlayer: nextPlayer,
        meta: {
          ...state.meta,
          turnNumber: state.meta.turnNumber + 1,
          round: wrappedAround ? state.meta.round + 1 : state.meta.round,
        },
        turn: { killsPlayed: 0, skillsUsed: [], phaseFlags: [] },
      };
    },
    toEvents(state: GameState, _atom: Atom & { type: 'nextPlayer' }): AtomEventResult {
      const alive = state.playerOrder.filter(name => state.players[name].info.alive);
      if (alive.length === 0) {
        const server = makeServerEvent('nextPlayer', { from: state.currentPlayer, to: state.currentPlayer, turnNumber: state.meta.turnNumber + 1 });
        return [server, new Map(), makePlayerEvent('nextPlayer', server.payload)];
      }
      const currentIdx = alive.indexOf(state.currentPlayer);
      const nextIdx = (Math.max(0, currentIdx) + 1) % alive.length;
      const nextPlayer = alive[nextIdx];
      const payload: Json = { from: state.currentPlayer, to: nextPlayer, turnNumber: state.meta.turnNumber + 1, round: currentIdx === -1 || nextIdx <= currentIdx ? state.meta.round + 1 : state.meta.round };
      const server = makeServerEvent('nextPlayer', payload);
      return [server, new Map(), makePlayerEvent('nextPlayer', payload)];
    },
  });
}
