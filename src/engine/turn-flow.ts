// src/engine/turn-flow.ts
// 额外回合（startTurn）公共 helper（模块 N：翻面/额外回合公共化）。
//
// 抽取原本在 放权/界凿险/博图/界放权 等技能中重复复刻的 startTurn 定义。
// 这些技能的内联 startTurn 实现完全一致（3 个 atom），合并为单一公共函数。
//
// 约束：本模块为纯重构，行为与原内联实现完全一致。
//   各调用方在 startTurn 前自行 clearPerTurnState（cancel 回合结束后 atom.apply 不执行，
//   需手动复刻其 per-turn 清理）。由于各技能 clearPerTurnState 清理的 vars 后缀集合
//   存在差异（放权 较其余少清 /givenTargets），按模块 N「不改行为」约束，保留各文件
//   本地 clearPerTurnState 实现，不并入本公共函数（否则会改动放权的可观察行为）。
import type { GameState } from './types';
import { applyAtom } from './create-engine';

/** 亲自启动 player 的一个完整回合（额外回合入口）：
 *  回合开始 → 准备阶段开始 → 准备阶段结束。
 *  回合管理的阶段推进 after-hook 据此自动走完该玩家的判定→摸牌→出牌→弃牌→回合结束。 */
export async function startTurn(
  state: GameState,
  player: number,
): Promise<void> {
  await applyAtom(state, { type: '回合开始', player });
  await applyAtom(state, { type: '阶段开始', player, phase: '准备' });
  await applyAtom(state, { type: '阶段结束', player, phase: '准备' });
}
