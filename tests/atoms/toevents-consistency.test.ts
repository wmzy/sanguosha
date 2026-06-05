import { describe, it, expect } from 'vitest';
import { applyAtoms } from "@engine/atom";
import { createTestGame } from '../engine-helpers';
import '@engine/atoms/index';

describe('toEvents 与 apply 一致性', () => {
  it('judge: deck 空+discardPile 有牌时，toEvents payload 包含被判定牌（apply reshuffle 后那张）', () => {
    let state = createTestGame({ playerCount: 2, playPhase: true });
    const cardC1 = { id: 'c1', name: '杀', type: '基本牌' as const, subtype: '杀' as const, suit: '♥' as const, rank: 'A' as const, description: '' };
    const cardC2 = { id: 'c2', name: '闪', type: '基本牌' as const, subtype: '闪' as const, suit: '♦' as const, rank: 'K' as const, description: '' };
    const cardC3 = { id: 'c3', name: '桃', type: '基本牌' as const, subtype: '桃' as const, suit: '♣' as const, rank: '5' as const, description: '' };
    state = {
      ...state,
      zones: { deck: [], discardPile: ['c1', 'c2', 'c3'] },
      cardMap: { ...state.cardMap, c1: cardC1, c2: cardC2, c3: cardC3 },
    };
    const before = state;
    const result = applyAtoms(before, [{ type: 'judge', player: 'P1' }]);
    const judgeEvent = result.state.serverLog.find(e => e.type === 'judge');
    expect(judgeEvent).toBeDefined();
    const payload = judgeEvent!.payload as { player: string; cardId: string | null; suit: string; rank: string; result: string };
    expect(payload.cardId).not.toBeNull();
    expect(['c1', 'c2', 'c3']).toContain(payload.cardId);
    const newState = result.state;
    expect(newState.zones.discardPile).toContain(payload.cardId);
    expect(newState.zones.discardPile.length).toBe(1);
    expect(newState.zones.deck).not.toContain(payload.cardId);
  });

  it('draw: deck 空+discardPile 有牌时，toEvents payload 包含真实抽到的牌', () => {
    let state = createTestGame({ playerCount: 2, playPhase: true });
    const discardedIds = ['c1', 'c2', 'c3'];
    state = {
      ...state,
      zones: { deck: [], discardPile: [...discardedIds] },
      cardMap: {
        ...state.cardMap,
        c1: { id: 'c1', name: '杀', type: '基本牌', subtype: '杀', suit: '♥', rank: 'A', description: '' },
        c2: { id: 'c2', name: '闪', type: '基本牌', subtype: '闪', suit: '♦', rank: 'K', description: '' },
        c3: { id: 'c3', name: '桃', type: '基本牌', subtype: '桃', suit: '♣', rank: '5', description: '' },
      },
    };
    const result = applyAtoms(state, [{ type: 'draw', player: 'P1', count: 2 }]);
    const drawEvent = result.state.serverLog.find(e => e.type === 'draw');
    expect(drawEvent).toBeDefined();
    const payload = drawEvent!.payload as { player: string; count: number; cards: string[] };
    expect(payload.count).toBe(2);
    expect(payload.cards).toHaveLength(2);
    for (const cardId of payload.cards) {
      expect(discardedIds).toContain(cardId);
    }
    expect(result.state.players.P1.hand).toEqual(expect.arrayContaining(payload.cards));
  });

  it('draw: deck 充足时，toEvents payload 包含 deck 前几张的牌', () => {
    const state = createTestGame({ playerCount: 2, playPhase: true });
    const topThree = state.zones.deck.slice(0, 3);
    const result = applyAtoms(state, [{ type: 'draw', player: 'P1', count: 3 }]);
    const drawEvent = result.state.serverLog.find(e => e.type === 'draw');
    expect(drawEvent).toBeDefined();
    const payload = drawEvent!.payload as { count: number; cards: string[] };
    expect(payload.count).toBe(3);
    expect(payload.cards).toEqual(topThree);
    expect(result.state.zones.deck).not.toContain(payload.cards[0]);
  });
});
