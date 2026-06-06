// engine/mark.ts — Mark 体系状态操作
//
// Mark 是「持续但有生命周期」的状态载体：
//   - faceDown（翻面） — 持续到 turnEnd
//   - chained（连环） — 字段化在 PlayerState.chained，不进 Mark（本文件不涉及）
//   - relation / transient — 关系标记 / 瞬时标记
//
// state.marks: Record<PlayerId, Mark[]> — 按玩家分组的 Mark 列表。
// 本文件只提供 add/remove/clear 三个纯函数，不注册 atom（见 engine/atoms/mark.ts）。

import type { GameState, Mark, TurnPhase } from './types';

/** 在指定玩家 marks 列表添加 Mark（按 id 去重） */
export function addMarkToPlayer(state: GameState, player: string, mark: Mark): GameState {
  const current = state.marks[player] ?? [];
  const filtered = current.filter((m) => m.id !== mark.id);
  return {
    ...state,
    marks: { ...state.marks, [player]: [...filtered, mark] },
  };
}

/** 按 id 移除 Mark */
export function removeMarkFromPlayer(state: GameState, player: string, markId: string): GameState {
  const current = state.marks[player] ?? [];
  return {
    ...state,
    marks: { ...state.marks, [player]: current.filter((m) => m.id !== markId) },
  };
}

/**
 * 在阶段推进时清理过期 Mark。
 * - permanent：永不清
 * - untilTurnEnd：仅在 phase === 'turnEnd' 时清
 * - untilPhaseEnd：relation scope 跟着 turnEnd 清；其它 scope 视具体语义扩展
 */
export function clearExpiredMarksByPhase(state: GameState, phase: TurnPhase): GameState {
  const next: GameState['marks'] = {};
  for (const [player, marks] of Object.entries(state.marks)) {
    const kept = marks.filter((m) => {
      if (m.duration === 'permanent') return true;
      if (m.duration === 'untilTurnEnd' && phase === 'turnEnd') return false;
      if (m.duration === 'untilPhaseEnd' && m.scope === 'relation' && phase === 'turnEnd') {
        return false;
      }
      return true;
    });
    next[player] = kept;
  }
  return { ...state, marks: next };
}
