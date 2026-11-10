import { describe, expect, it } from 'vitest';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import '../../src/engine/atoms';

describe('移动暂存牌 atom', () => {
  it('把单张暂存实体牌返还手牌并从暂存列表移除', async () => {
    const state = createGameState({
      players: [{
        index: 0, name: 'P0', character: '毌丘俭', health: 4, maxHealth: 4,
        alive: true, hand: [], equipment: {}, pendingTricks: [], skills: [],
        vars: { '征荣/实体荣': ['rong-1', 'rong-2'] }, marks: [], tags: [],
      }],
      cardMap: { 'rong-1': { id: 'rong-1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' } },
    });

    await applyAtom(state, { type: '移动暂存牌', player: 0, varsKey: '征荣/实体荣', cardId: 'rong-1', to: '手牌' });

    expect(state.players[0].hand).toEqual(['rong-1']);
    expect(state.players[0].vars['征荣/实体荣']).toEqual(['rong-2']);
    expect(state.zones.discardPile).not.toContain('rong-1');
  });

  it('清侧弃置单张暂存荣后实体牌进入弃牌堆且不再暂存', async () => {
    const state = createGameState({
      players: [{
        index: 0, name: 'P0', character: '毌丘俭', health: 4, maxHealth: 4,
        alive: true, hand: [], equipment: {}, pendingTricks: [], skills: [],
        vars: { '征荣/实体荣': ['rong-1', 'rong-2'] }, marks: [], tags: [],
      }],
      cardMap: { 'rong-1': { id: 'rong-1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' } },
    });

    await applyAtom(state, { type: '移动暂存牌', player: 0, varsKey: '征荣/实体荣', cardId: 'rong-1', to: '弃牌堆' });

    expect(state.zones.discardPile).toContain('rong-1');
    expect(state.players[0].vars['征荣/实体荣']).toEqual(['rong-2']);
  });
});
