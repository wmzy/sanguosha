import { describe, it, expect } from 'vitest';
import { applyAtom, atomToEvents } from '@engine/atom';
import type { GameState } from '@engine/types';
import { createTestGame } from '../engine-helpers';
import '@engine/atoms/index';

describe.skip('判定', () => {
  it('apply: 从牌堆顶抽判定牌并置入弃牌堆', () => {
    const state = createTestGame();
    const topCard = state.zones.deck[state.zones.deck.length - 1];
    const result = applyAtom(state, { type: '判定', player: 'P1' });
    expect(result.zones.discardPile).toContain(topCard);
    expect(result.zones.deck).not.toContain(topCard);
  });

  it('apply: 牌堆为空时洗弃牌堆再判定', () => {
    const state = createTestGame();
    const deckCards = [...state.zones.deck];
    const emptied: GameState = { ...state, zones: { deck: [], discardPile: deckCards } };
    const result = applyAtom(emptied, { type: '判定', player: 'P1' });
    expect(result.zones.discardPile.length).toBe(1);
    expect(result.zones.deck.length).toBe(deckCards.length - 1);
  });

  it('toEvents: 生成 judge 事件', () => {
    const state = createTestGame();
    const [serverEvent] = atomToEvents(state, { type: '判定', player: 'P1' });
    expect(serverEvent.type).toBe('判定');
    expect((serverEvent.payload as Record<string, unknown>).player).toBe('P1');
  });
});

describe('击杀', () => {
  it('apply: 将玩家标记为阵亡', () => {
    const state = createTestGame();
    const result = applyAtom(state, { type: '击杀', player: 'P1', source: 'P2' });
    expect(result.players.P1.info.alive).toBe(false);
  });

  it('toEvents: 生成 kill 事件', () => {
    const state = createTestGame();
    const [serverEvent] = atomToEvents(state, { type: '击杀', player: 'P1', source: 'P2' });
    expect(serverEvent.type).toBe('击杀');
    expect((serverEvent.payload as Record<string, unknown>).player).toBe('P1');
    expect((serverEvent.payload as Record<string, unknown>).source).toBe('P2');
  });
});
