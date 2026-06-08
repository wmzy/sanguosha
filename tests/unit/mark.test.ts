import { describe, it, expect, beforeEach } from 'vitest';
import { applyAtoms, clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { registerAllAtoms } from '@engine/atoms';
import { createTestGame } from '../engine-helpers';
import type { Mark } from '@engine/types';

describe('Mark 体系', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
  });

  it('GameState.marks 默认空 Record', () => {
    const s0 = createTestGame();
    expect(s0.marks).toEqual({});
  });

  it('addMark 写入玩家 marks 列表', () => {
    const s0 = createTestGame();
    const mark: Mark = { id: 'faceDown:P1', scope: 'player', payload: { faceDown: true }, duration: 'untilTurnEnd' };
    const { state, logEntries: events } = applyAtoms(s0, [
      { type: '加标记', player: 'P1', mark },
    ]);
    expect(state.marks.P1).toHaveLength(1);
    expect(state.marks.P1[0]).toEqual(mark);
    expect(events[0].atom.type).toBe('加标记');
  });

  it('removeMark 按 id 移除', () => {
    const s0 = createTestGame();
    const mark: Mark = { id: 'faceDown:P1', scope: 'player', duration: 'untilTurnEnd' };
    const s1 = applyAtoms(s0, [
      { type: '加标记', player: 'P1', mark },
    ]).state;
    const { state } = applyAtoms(s1, [
      { type: '去标记', player: 'P1', markId: 'faceDown:P1' },
    ]);
    expect(state.marks.P1).toEqual([]);
  });

  it('clearExpiredMarks 清理 untilTurnEnd 的 Mark', () => {
    const s0 = {
      ...createTestGame(),
      marks: {
        P1: [{ id: 'faceDown:P1', scope: 'player' as const, duration: 'untilTurnEnd' as const }],
        P2: [{ id: 'permanent:P2', scope: 'player' as const, duration: 'permanent' as const }],
      },
    };
    const { state } = applyAtoms(s0, [
      { type: '清过期标记', phase: '回合结束' },
    ]);
    expect(state.marks.P1).toEqual([]);
    expect(state.marks.P2).toHaveLength(1);
  });
});
