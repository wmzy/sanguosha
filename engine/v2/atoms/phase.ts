import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';

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
    const currentIdx = alive.indexOf(state.currentPlayer);
    const nextIdx = (currentIdx + 1) % alive.length;
    const nextPlayer = alive[nextIdx];
    return {
      ...state,
      currentPlayer: nextPlayer,
      meta: { ...state.meta, turnNumber: state.meta.turnNumber + 1 },
      turn: { killsPlayed: 0, skillsUsed: [], phaseFlags: [] },
    };
  },
  toEvents(state: GameState, _atom: Atom & { type: 'nextPlayer' }): AtomEventResult {
    const alive = state.playerOrder.filter(name => state.players[name].info.alive);
    const currentIdx = alive.indexOf(state.currentPlayer);
    const nextIdx = (currentIdx + 1) % alive.length;
    const nextPlayer = alive[nextIdx];
    const payload: Json = { from: state.currentPlayer, to: nextPlayer, turnNumber: state.meta.turnNumber + 1 };
    const server = makeServerEvent('nextPlayer', payload);
    return [server, new Map(), makePlayerEvent('nextPlayer', payload)];
  },
});
