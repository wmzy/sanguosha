// engine/mark.ts — Mark 体系状态操作
//
// Mark 是「持续但有生命周期」的状态载体（[T-05/T-07] 决策）：
//   - chained（铁索连环）— id='chained', scope='player', duration='permanent'
//   - faceDown（翻面）— id='faceDown', scope='player', duration='untilTurnEnd'
//     （曹仁据守/贾诩放逐/雷击前置；未落地，列在 MarkId 联合中备查）
//   - relation / transient — 关系标记 / 瞬时标记（未落地，暂未列联合）
//
// state.marks: Record<PlayerId, Mark[]> — 按玩家分组的 Mark 列表。
// 本文件只提供 add/remove/clear 三个纯函数 + 便捷查询（hasMark/hasChained），
// 不注册 atom（见 engine/atoms/mark.ts）。
//
// **chained 之前是 PlayerState.chained 字段，2026-06-06 P5-T1 迁入 Mark 体系**。
// 任何读取 chained 状态的代码必须走 hasChained(state, player)，不要再读字段。
import type { GameState, Mark, TurnPhase } from './types';

/** Mark id 字面量联合（类型安全，避免字符串 typo）。
 * 仅列已落地的 Mark；新 Mark 落地时同步追加此联合 + 构造常量 + 便捷查询函数。*/
export type MarkId =
  | 'chained';
export const CHAINED_MARK: Mark = {
  id: 'chained',
  scope: 'player',
  duration: 'permanent',
};

/** 在指定玩家 marks 列表添加 Mark（按 id 去重）*/
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
 * - untilTurnEnd：仅在 phase === '回合结束' 时清
 * - untilPhaseEnd：relation scope 跟着 turnEnd 清；其它 scope 视具体语义扩展
 */
export function clearExpiredMarksByPhase(state: GameState, phase: TurnPhase): GameState {
  const next: GameState['marks'] = {};
  for (const [player, marks] of Object.entries(state.marks)) {
    const kept = marks.filter((m) => {
      if (m.duration === 'permanent') return true;
      if (m.duration === 'untilTurnEnd' && phase === '回合结束') return false;
      if (m.duration === 'untilPhaseEnd' && m.scope === 'relation' && phase === '回合结束') {
        return false;
      }
      return true;
    });
    next[player] = kept;
  }
  return { ...state, marks: next };
}

/** 查询玩家是否有指定 id 的 Mark（字面量联合，编译期校验）*/
export function hasMark(state: GameState, player: string, markId: MarkId): boolean {
  return (state.marks[player] ?? []).some((m) => m.id === markId);
}

/** 便捷查询：玩家是否处于连环状态（chained Mark）*/
export function hasChained(state: GameState, player: string): boolean {
  return hasMark(state, player, 'chained');
}

/** 同链上其他 chained 角色（不含 player 自己）*/
export function getChainedOthers(state: GameState, player: string): string[] {
  return Object.entries(state.players)
    .filter(([name, _p]) => name !== player && hasChained(state, name))
    .map(([name]) => name);
}
