// tests/integration/facedown-skip-turn.test.ts
//
// faceDown Mark（被翻面）→ 玩家整个回合跳过（turnStart 时直接 nextPlayer）。
// 这是 T-07 的真 game rule 落地：与现有 shouldSkipPhase（用 skipPlay tag 跳过
// 出牌阶段）正交——faceDown 跳过整回合，skipPlay 跳过单阶段。
//
// 现有 `clearExpiredMarks` atom（engine/atoms/mark.ts）：
//   - untilTurnEnd + phase='turnEnd' → 清 player-scope
//   - untilPhaseEnd + player scope → 不清（relation scope 在 turnEnd 清）
//
// 测试策略：直接构造 faceDown Mark，验证 advanceToInteractivePhase 调
// nextPlayer 跳过整回合。

import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';
import { advanceToInteractivePhase } from '@engine/phase-advance';
import type { Mark } from '@engine/types';

describe('faceDown Mark 跳过整个回合（真 game rule）', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('P1 有 faceDown Mark（untilTurnEnd）→ turnStart 时直接 nextPlayer 跳过整回合', () => {
    const s0 = createTestGame();
    const faceDown: Mark = { id: 'faceDown:P1', scope: 'player', duration: 'untilTurnEnd' };
    const addResult = applyAtoms(s0, [
      { type: 'addMark', player: 'P1', mark: faceDown },
    ]);
    const result = advanceToInteractivePhase(addResult.state);
    // 期望：P2 变成 currentPlayer（已跳到 P2 准备阶段）
    expect(result.state.currentPlayer).toBe('P2');
    // faceDown Mark 应被清理（untilTurnEnd 在 clearExpiredMarks(phase='turnEnd') 清理）
    expect(result.state.marks.P1 ?? []).toEqual([]);
  });

  it('P1 无 faceDown Mark → 正常进入出牌阶段', () => {
    const s0 = createTestGame();
    const result = advanceToInteractivePhase(s0);
    expect(result.state.currentPlayer).toBe('P1');
    expect(result.state.phase).toBe('出牌');
  });

  it('faceDown Mark 持续 untilPhaseEnd 不在本次 turnStart 清理', () => {
    // 注：untilPhaseEnd 仅在 relation 作用域被清理
    // 玩家 faceDown 默认 untilTurnEnd 语义
    const s0 = createTestGame();
    const faceDown: Mark = { id: 'faceDown:P1', scope: 'player', duration: 'untilPhaseEnd' };
    const addResult = applyAtoms(s0, [
      { type: 'addMark', player: 'P1', mark: faceDown },
    ]);
    // untilPhaseEnd + player scope → 仍 skip 整回合（faceDown 永久直到 phase 结束）
    // 但不清理 mark（player scope + untilPhaseEnd 不在 turnEnd clear）
    const result = advanceToInteractivePhase(addResult.state);
    expect(result.state.currentPlayer).toBe('P2');
    // Mark 仍存在（player + untilPhaseEnd 不被 turnEnd clear）
    expect(result.state.marks.P1?.[0]?.id).toBe('faceDown:P1');
  });
});
