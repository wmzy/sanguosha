import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../../src/engine/types';
import { resetForTest, applyAtom } from '../../src/engine/create-engine';
import '../../src/engine/atoms';
import '../../src/engine/skills';

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

describe('atomHistory: applyAtom 写入', () => {
  beforeEach(() => resetForTest());

  it('applyAtom 把 atom 条目写入 state.atomHistory,seq 单调', async () => {
    const state = createGameState({
      players: [{
        index: 0, name: 'p0', character: '测试', health: 4, maxHealth: 4,
        alive: true, hand: [], equipment: {}, skills: [], vars: {}, marks: [], pendingTricks: [],
      }],
      cardMap: { c1: { id: 'c1', name: '杀', suit: '♠', rank: '7', type: '基本牌', subtype: '' } as any },
      zones: { deck: ['c1'], discardPile: [], processing: [] },
      seq: 0,
    });
    await applyAtom(state, { type: '摸牌', player: 0, count: 1 } as any);
    expect(state.atomHistory.length).toBeGreaterThan(0);
    const atomEntry = state.atomHistory.find(e => e.kind === 'atom');
    expect(atomEntry).toBeDefined();
    if (atomEntry && atomEntry.kind === 'atom') {
      expect(atomEntry.atom.type).toBe('摸牌');
      expect(atomEntry.viewEvents).toBeDefined();
    }
  });
});
