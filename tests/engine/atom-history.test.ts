import { describe, it, expect } from 'vitest';
import { createGameState } from '../../src/engine/types';

describe('GameState.atomHistory', () => {
  it('createGameState 初始化 atomHistory 为空数组', () => {
    const state = createGameState({ players: [], cardMap: {} });
    expect(state.atomHistory).toEqual([]);
  });

  it('createGameState 允许 partial 覆盖 atomHistory', () => {
    const existing = [{ kind: 'notify' as const, seq: 5, skillId: '', eventType: 'test', data: null }];
    const state = createGameState({ players: [], cardMap: {}, atomHistory: existing });
    expect(state.atomHistory).toBe(existing);
  });
});
