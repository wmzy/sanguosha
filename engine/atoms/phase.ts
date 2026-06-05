// engine/atoms/phase.ts — 阶段切换相关 atom
//
// 设计依据：
// - docs/decisions/0013-phase-begin-end-atoms.md: setPhase 拆分为显式成对的
//   phaseBegin/phaseEnd，避免"xx阶段开始"和"yy阶段结束"乱序（克己等技能）
// - state.turn.turnStarted: boolean 字段替代 phaseFlags 数组里的 'turnStarted'
//   字符串，类型更安全

import type { GameState, Atom, AtomEventResult, Json } from '../types';
import { registerAtom } from '../atom';
import { makeServerEvent, makePlayerEvent } from '../event';

export function register() {
  // setPhase: 单纯修改 state.phase 字段
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

  // phaseBegin atom: 阶段开始通知（写 serverLog，给技能钩子）
  registerAtom({
    type: 'phaseBegin',
    apply(state: GameState, _atom: Atom & { type: 'phaseBegin' }) {
      return state;
    },
    toEvents(state: GameState, atom: Atom & { type: 'phaseBegin' }): AtomEventResult {
      const phase = atom.phase as string;
      const player = atom.player as string;
      const payload: Json = { phase, player };
      return [makeServerEvent('phaseBegin', payload), new Map(), makePlayerEvent('phaseBegin', payload)];
    },
  });

  // phaseEnd atom: 阶段结束通知
  registerAtom({
    type: 'phaseEnd',
    apply(state: GameState, _atom: Atom & { type: 'phaseEnd' }) {
      return state;
    },
    toEvents(state: GameState, atom: Atom & { type: 'phaseEnd' }): AtomEventResult {
      const phase = atom.phase as string;
      const player = atom.player as string;
      const payload: Json = { phase, player };
      return [makeServerEvent('phaseEnd', payload), new Map(), makePlayerEvent('phaseEnd', payload)];
    },
  });

  // nextPlayer: 切换到下一玩家，turn state 重置（turnStarted: false 让下一回合重新派 turnStart）
  registerAtom({
    type: 'nextPlayer',
    apply(state: GameState, _atom: Atom & { type: 'nextPlayer' }) {
      const alive = state.playerOrder.filter((name) => state.players[name].info.alive);
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
        turn: { killsPlayed: 0, skillsUsed: [], turnStarted: false },
      };
    },
    toEvents(state: GameState, _atom: Atom & { type: 'nextPlayer' }): AtomEventResult {
      const alive = state.playerOrder.filter((name) => state.players[name].info.alive);
      if (alive.length === 0) {
        const server = makeServerEvent('nextPlayer', {
          from: state.currentPlayer,
          to: state.currentPlayer,
          turnNumber: state.meta.turnNumber + 1,
        });
        return [server, new Map(), makePlayerEvent('nextPlayer', server.payload)];
      }
      const currentIdx = alive.indexOf(state.currentPlayer);
      const nextIdx = (Math.max(0, currentIdx) + 1) % alive.length;
      const nextPlayer = alive[nextIdx];
      const payload: Json = {
        from: state.currentPlayer,
        to: nextPlayer,
        turnNumber: state.meta.turnNumber + 1,
        round: currentIdx === -1 || nextIdx <= currentIdx ? state.meta.round + 1 : state.meta.round,
      };
      const server = makeServerEvent('nextPlayer', payload);
      return [server, new Map(), makePlayerEvent('nextPlayer', payload)];
    },
  });
}
