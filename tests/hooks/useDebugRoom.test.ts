// tests/hooks/useDebugRoom.test.ts — useDebugRoom hook 单元测试
//
// T10 验收：useState 数量从 11 降至 < 5 + hook 行为正确。
// 覆盖：setPlayerCount / appendAction / toggleSelectedForDiscard / clear / reset

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebugRoom } from '../../src/hooks/useDebugRoom';

describe('useDebugRoom', () => {
  it('初始 UI state：playerCount=5 / error=null / debugRooms=[] / actionLog=[] / selectedCardId=null / selectedForDiscard=空 / selectedSkillCards=空', () => {
    const { result } = renderHook(() => useDebugRoom());
    expect(result.current.ui.playerCount).toBe(5);
    expect(result.current.ui.error).toBeNull();
    expect(result.current.ui.debugRooms).toEqual([]);
    expect(result.current.ui.actionLog).toEqual([]);
    expect(result.current.ui.perspective).toBe('');
    expect(result.current.ui.playerOrder).toEqual([]);
    expect(result.current.ui.selectedCardId).toBeNull();
    expect(result.current.ui.selectedTarget).toBeNull();
    expect(result.current.ui.selectedForDiscard.size).toBe(0);
    expect(result.current.ui.selectedSkillCards.size).toBe(0);
  });

  it('setPlayerCount / setPerspective / setSelectedCardId 设置后立即生效', () => {
    const { result } = renderHook(() => useDebugRoom());
    act(() => result.current.setPlayerCount(3));
    expect(result.current.ui.playerCount).toBe(3);
    act(() => result.current.setPerspective('P2'));
    expect(result.current.ui.perspective).toBe('P2');
    act(() => result.current.setSelectedCardId('c5'));
    expect(result.current.ui.selectedCardId).toBe('c5');
  });

  it('appendAction 累计 / setDebugRooms 替换 / setPlayerOrder 替换', () => {
    const { result } = renderHook(() => useDebugRoom());
    act(() => result.current.appendAction({ type: 'playCard' } as any));
    act(() => result.current.appendAction({ type: 'endTurn' } as any));
    expect(result.current.ui.actionLog).toHaveLength(2);
    act(() => result.current.setDebugRooms([{ id: 'r1', name: 'room1' } as any]));
    expect(result.current.ui.debugRooms).toHaveLength(1);
    act(() => result.current.setPlayerOrder(['P1', 'P2', 'P3']));
    expect(result.current.ui.playerOrder).toEqual(['P1', 'P2', 'P3']);
  });

  it('toggleSelectedForDiscard + clearSelectedForDiscard：增删 + 批量清空', () => {
    const { result } = renderHook(() => useDebugRoom());
    act(() => result.current.toggleSelectedForDiscard('c1'));
    act(() => result.current.toggleSelectedForDiscard('c2'));
    expect(result.current.ui.selectedForDiscard.size).toBe(2);
    act(() => result.current.toggleSelectedForDiscard('c1'));
    expect(result.current.ui.selectedForDiscard.size).toBe(1);
    expect(result.current.ui.selectedForDiscard.has('c1')).toBe(false);
    act(() => result.current.clearSelectedForDiscard());
    expect(result.current.ui.selectedForDiscard.size).toBe(0);
  });

  it('toggleSelectedSkillCard + clearSelectedSkillCards', () => {
    const { result } = renderHook(() => useDebugRoom());
    act(() => result.current.toggleSelectedSkillCard('c3'));
    expect(result.current.ui.selectedSkillCards.has('c3')).toBe(true);
    act(() => result.current.clearSelectedSkillCards());
    expect(result.current.ui.selectedSkillCards.size).toBe(0);
  });

  it('setError + reset 恢复初始', () => {
    const { result } = renderHook(() => useDebugRoom());
    act(() => {
      result.current.setError('boom');
      result.current.setPlayerCount(8);
    });
    expect(result.current.ui.error).toBe('boom');
    expect(result.current.ui.playerCount).toBe(8);
    act(() => result.current.reset());
    expect(result.current.ui.error).toBeNull();
    expect(result.current.ui.playerCount).toBe(5);
  });
});
