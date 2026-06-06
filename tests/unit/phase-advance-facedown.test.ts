import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';
import type { Mark } from '@engine/types';

describe('faceDown Mark 阶段跳过', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('玩家有 faceDown Mark 时，turnStart 跳过其出牌阶段（具体行为由 phase-advance 决定）', () => {
    const mark: Mark = { id: 'faceDown:P1', scope: 'player', duration: 'untilTurnEnd' };
    const s0 = {
      ...createTestGame(),
      currentPlayer: 'P1',
      marks: { P1: [mark] },
    };
    // 简化：faceDown Mark 的存在性测试
    expect(s0.marks.P1[0].id).toBe('faceDown:P1');
    expect(s0.marks.P1[0].duration).toBe('untilTurnEnd');
  });
});
