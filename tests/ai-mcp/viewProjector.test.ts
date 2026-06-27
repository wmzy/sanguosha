// tests/ai-mcp/viewProjector.test.ts
import { describe, it, expect } from 'vitest';
import { projectView } from '../../src/ai-mcp/viewProjector';
import type { GameView } from '../../src/engine/types';

function makeFullView(): GameView {
  return {
    viewer: 0, currentPlayerIndex: 0, phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: { secret: 'x' } },
    players: [{
      index: 0, name: 'P0', character: '刘备', health: 4, maxHealth: 4,
      alive: true, equipment: {}, skills: ['仁德'], handCount: 1,
      hand: [{ id: 'c1', name: '杀', suit: '♠', rank: '5', type: '基本牌' }], marks: [],
      distanceVars: { attackMod: 0, defenseMod: 0, attackRange: 1 },
    }],
    cardMap: {}, pending: null, deadline: null, deadlineTotalMs: 0,
    log: Array.from({ length: 30 }, (_, i) => ({ time: i, player: 0, text: `evt${i}` })),
    settlementStack: [],
    zones: { deckCount: 50, discardPileCount: 0, processing: [] },
  };
}

describe('projectView', () => {
  it('投影保留决策字段，丢弃引擎细节', () => {
    const snap = projectView(makeFullView());
    expect(snap.viewer).toBe(0);
    expect(snap.players[0].hand).toHaveLength(1);
    expect(snap.log.length).toBeLessThanOrEqual(20); // 截断
    expect((snap.players[0] as { distanceVars?: unknown }).distanceVars).toBeUndefined(); // 丢弃
    expect((snap as { settlementStack?: unknown }).settlementStack).toBeUndefined();
  });

  it('无 zones 时回退为 0', () => {
    const view = makeFullView();
    view.zones = undefined;
    const snap = projectView(view);
    expect(snap.zones).toEqual({ deckCount: 0, discardPileCount: 0 });
  });

  it('pending 投影出 target/isBlocking/requestType', () => {
    const view = makeFullView();
    view.pending = {
      type: 'awaits',
      atom: { type: '询问闪', player: 0 } as unknown as GameView['pending'] extends infer P ? P extends { atom: infer A } ? A : never : never,
      prompt: { type: 'useCard', title: '请出闪', cardFilter: { filter: () => true, min: 1, max: 1 } } as unknown as GameView['pending'] extends infer P ? P extends { prompt: infer PR } ? PR : never : never,
      target: 0, isBlocking: true,
    } as unknown as GameView['pending'];
    const snap = projectView(view);
    expect(snap.pending).not.toBeNull();
    expect(snap.pending!.target).toBe(0);
    expect(snap.pending!.isBlocking).toBe(true);
    expect(snap.pending!.promptTitle).toBe('请出闪');
    expect(snap.pending!.requestType).toBe('');
  });
});
