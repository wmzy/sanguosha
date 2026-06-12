// @ts-nocheck
// engine/atoms/turn.ts — turnStart / nextPlayer / incrementKills
//
// turnStart 原子化（Phase 8 / ADR 0011）：
// 改造前 phase-advance.ts:197-208 用 emitEvent(turnStart) 派 GameEvent +
// 用 makeServerEvent('turnStart') 派 server event。后者**不进** state.serverLog。
// 改造后 turnStart atom 的 toEvents 派 server event 走 applyAtoms → broadcast
// 路径，自动写进 state.serverLog。ReplayEngine 用 reduceGameState 已支持
// turnStart（engine/view/reducer.ts:559-562），可正确 replay。
//
// phaseBegin / phaseEnd 仍是 GameEvent 派发（emitEvent）——它们是技能钩子
// 概念，**不**进 serverLog 也不进流水；"进入X阶段"语义由 setPhase
// server event 表达。

import type { GameState, Atom } from '../types';
import { registerAtom } from '../atom';

export function register() {
  registerAtom({
    type: '累计出杀',
    apply(state: GameState, _atom: Atom & { type: '累计出杀' }) {
      return {
        ...state,
        turn: {
          ...state.turn,
          killsPlayed: state.turn.killsPlayed + 1,
        },
      };
    },
  });

  registerAtom({
    type: '回合开始',
    apply(state: GameState, _atom: Atom & { type: '回合开始' }) {
      // 状态修改由 nextPlayer atom 负责（已有）；这里不重复改 state。
      // phase-advance.ts 在 emitEvent(turnStart) 之后手工加 'turnStarted' phaseFlag，
      // 这部分也保留不动。
      return state;
    },
  });
}
