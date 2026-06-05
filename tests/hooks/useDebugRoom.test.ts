// tests/hooks/useDebugRoom.test.ts — useDebugRoom hook 单元测试
//
// 覆盖：setPlayerCount / appendOperations / setOperations / toggleSelectedForDiscard / clear / reset

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebugRoom } from '../../src/hooks/useDebugRoom';

describe('useDebugRoom', () => {
  it('初始 UI state：playerCount=5 / error=null / debugRooms=[] / operations=[] / selectedCardId=null / selectedForDiscard=空 / selectedSkillCards=空', () => {
    const { result } = renderHook(() => useDebugRoom());
    expect(result.current.ui.playerCount).toBe(5);
    expect(result.current.ui.error).toBeNull();
    expect(result.current.ui.debugRooms).toEqual([]);
    expect(result.current.ui.operations).toEqual([]);
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

  it('appendOperations 累加 / setDebugRooms 替换 / setPlayerOrder 替换', () => {
    const { result } = renderHook(() => useDebugRoom());
    act(() => result.current.appendOperations([
      { seq: 1, timestamp: Date.now(), type: 'play', data: {}, description: 'P1 使用了一张牌' },
    ]));
    act(() => result.current.appendOperations([
      { seq: 2, timestamp: Date.now(), type: 'turnChange', data: {}, description: 'P1 结束回合' },
    ]));
    expect(result.current.ui.operations).toHaveLength(2);
    act(() => result.current.setDebugRooms([{ id: 'r1', name: 'room1' } as any]));
    expect(result.current.ui.debugRooms).toHaveLength(1);
    act(() => result.current.setPlayerOrder(['P1', 'P2', 'P3']));
    expect(result.current.ui.playerOrder).toEqual(['P1', 'P2', 'P3']);
  });

  it('appendOperations 保留服务端下发的 seq', () => {
    const { result } = renderHook(() => useDebugRoom());
    const ops = [
      { seq: 5, timestamp: Date.now(), type: 'play' as const, data: {}, description: 'P1 使用了一张牌' },
      { seq: 6, timestamp: Date.now(), type: 'turnChange' as const, data: {}, description: 'P1 结束回合' },
    ];
    act(() => result.current.appendOperations(ops));
    expect(result.current.ui.operations.map((o) => o.seq)).toEqual([5, 6]);
  });

  it('setOperations 全量替换', () => {
    const { result } = renderHook(() => useDebugRoom());
    act(() => result.current.appendOperations([
      { seq: 1, timestamp: Date.now(), type: 'play', data: {}, description: 'P1 使用了一张牌' },
    ]));
    act(() => result.current.setOperations([
      { seq: 10, timestamp: Date.now(), type: 'gameStart', data: {}, description: '游戏开始' },
    ]));
    expect(result.current.ui.operations).toHaveLength(1);
    expect(result.current.ui.operations[0].seq).toBe(10);
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

  it('setError + reset 恢复初始（operations 也被清空）', () => {
    const { result } = renderHook(() => useDebugRoom());
    act(() => {
      result.current.setError('boom');
      result.current.setPlayerCount(8);
    });
    act(() => result.current.appendOperations([
      { seq: 1, timestamp: Date.now(), type: 'play', data: {}, description: 'P1 使用了一张牌' },
    ]));
    expect(result.current.ui.error).toBe('boom');
    expect(result.current.ui.playerCount).toBe(8);
    expect(result.current.ui.operations).toHaveLength(1);
    act(() => result.current.reset());
    expect(result.current.ui.error).toBeNull();
    expect(result.current.ui.playerCount).toBe(5);
    expect(result.current.ui.operations).toEqual([]);
  });
});
