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
    type: '设阶段',
    apply(state: GameState, atom: Atom & { type: '设阶段' }) {
      return { ...state, phase: atom.phase };
    },
    toEvents(state: GameState, atom: Atom & { type: '设阶段' }): AtomEventResult {
      const payload: Json = { phase: atom.phase, player: state.currentPlayer };
      const server = makeServerEvent('设阶段', payload);
      return [server, new Map(), makePlayerEvent('设阶段', payload)];
    },
  });

  // phaseBegin atom: 阶段开始通知（写 serverLog，给技能钩子）
  registerAtom({
    type: '阶段开始',
    apply(state: GameState, _atom: Atom & { type: '阶段开始' }) {
      return state;
    },
    toEvents(state: GameState, atom: Atom & { type: '阶段开始' }): AtomEventResult {
      const phase = atom.phase as string;
      const player = atom.player as string;
      const payload: Json = { phase, player };
      return [makeServerEvent('阶段开始', payload), new Map(), makePlayerEvent('阶段开始', payload)];
    },
  });

  // phaseEnd atom: 阶段结束通知
  registerAtom({
    type: '阶段结束',
    apply(state: GameState, _atom: Atom & { type: '阶段结束' }) {
      return state;
    },
    toEvents(state: GameState, atom: Atom & { type: '阶段结束' }): AtomEventResult {
      const phase = atom.phase as string;
      const player = atom.player as string;
      const payload: Json = { phase, player };
      return [makeServerEvent('阶段结束', payload), new Map(), makePlayerEvent('阶段结束', payload)];
    },
  });

  // nextPlayer: 切换到下一玩家，turn state 重置（turnStarted: false 让下一回合重新派 turnStart）
  registerAtom({
    type: '下一玩家',
    apply(state: GameState, _atom: Atom & { type: '下一玩家' }) {
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
    toEvents(state: GameState, _atom: Atom & { type: '下一玩家' }): AtomEventResult {
      const alive = state.playerOrder.filter((name) => state.players[name].info.alive);
      if (alive.length === 0) {
        const server = makeServerEvent('下一玩家', {
          from: state.currentPlayer,
          to: state.currentPlayer,
          turnNumber: state.meta.turnNumber + 1,
        });
        return [server, new Map(), makePlayerEvent('下一玩家', server.payload)];
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
      const server = makeServerEvent('下一玩家', payload);
      return [server, new Map(), makePlayerEvent('下一玩家', payload)];
    },
  });
}
